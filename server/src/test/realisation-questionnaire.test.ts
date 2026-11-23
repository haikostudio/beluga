import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LE MODE RÉALISATION SUIT LE PARCOURS DU CAHIER DES CHARGES (18/10/2026).
 *
 *  - l'état vit sur la carte (`Card.realisation`) : genre, avancement, phase,
 *    pause — et le pourcentage, la barre et les boutons s'en déduisent ;
 *  - allumer la caméra pose un état neuf SANS genre : l'écran pose « Image ou
 *    vidéo ? », rien ne part au moteur, et l'outil d'avancement refuse ;
 *  - la réponse écrit le genre ; l'outil réécrit le document du projet et
 *    l'avancement ; le budget se lit dans ce document ;
 *  - la pause et la reprise touchent l'état, jamais la colonne ;
 *  - éteindre garde l'état ; le volet n'existe qu'avant le travail.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'realisation-questionnaire-'));
process.env.BELUGA_DATA = bacASable;
// Aucun modèle de traduction dans le bac à sable : la consigne passe telle quelle.
process.env.BELUGA_TRADUCTION_IDENTITE = "1";
process.env.BELUGA_MEDIAS = path.join(bacASable, 'disque-de-stockage', 'beluga-medias');

const {
  Agent,
  Card,
  Project,
  barreDEcritureDuVoletDeRealisation,
  barreDEcritureDuVolet,
  typesDeMediaDeLaRealisation,
  etapesDuMedia,
  etapeCouranteDuMedia,
  documentDeRealisation,
  estVoletDeRealisation,
  cheminDeRealisationVisible,
  lireAvancementDeRealisation,
  pauseDeRealisationPossible,
  cahierDeRealisationManquant,
  REFUS_COMPREHENSION_SANS_CAHIER,
  realisationNeuve,
  repriseDeRealisationPossible,
  rubriquesDuDocumentDeRealisation,
  budgetDuCahier,
  RUBRIQUES_DE_REALISATION,
} = await import('@beluga/shared');
/* fal.ai et Higgsfield sont CACHÉS depuis le 25/10/2026 (kie.ai les remplace),
   mais leur chaîne reste éprouvée : ces tests la rallument pour eux-mêmes. */
(await import('@beluga/shared')).fixerLesServicesCaches([]);
const store = await import('../store.js');
const q = await import('../realisation-questionnaire.js');
const { budgetDeLaCarte, consigneDeRealisationDeLaCarte } = await import('../realisation.js');
const { outilServiA } = await import('../tools.js');

const projet = store.saveProject(
  Project.parse({ id: 'projet-camera', name: 'Atelier', path: bacASable, createdAt: store.now(), updatedAt: store.now() }),
);

function carteDeCadrage(id: string) {
  const c = store.saveCard(
    Card.parse({
      id: `${id}-0000-0000-0000-000000000000`,
      projectId: projet.id,
      column: 'planned',
      position: 1,
      title: 'Première vidéo de vente',
      run: { engine: 'claude', model: 'opus' },
      parcours: { plans: [] },
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );
  store.saveAgent(
    Agent.parse({ id: `cadrage-${id}`, projectId: projet.id, cardId: c.id, role: 'cadrage', title: 'Cadrage', run: { engine: 'claude', model: 'opus' }, status: 'idle', createdAt: store.now(), updatedAt: store.now() }),
  );
  return c;
}

/** La réponse à la première question, telle que le cadrage la passe à l'outil. */
function choisirLesTypes(id: string, media: 'video' | 'image' | 'son') {
  q.basculerLaRealisation(`${id}-0000-0000-0000-000000000000`, media);
  const r = q.ecrireLaRealisation(`cadrage-${id}`, { document: '# Réalisation\n\n## Intention\nÀ voir\n', faites: 1, total: 10, phase: 'intention' });
  assert.ok(r.ok, r.text);
  return store.getCard(`${id}-0000-0000-0000-000000000000`)!;
}

test('les règles pures : état, pourcentage, barre, étape courante, boutons', () => {
  const neuf = realisationNeuve();
  const barre = (r: unknown) => etapesDuMedia({ carte: { column: 'planned', realisation: r as never } });
  /* Les quatre étapes du 26/10/2026 : le brief d'abord, le type se choisit au bouton caméra. */
  assert.deepEqual(barre(neuf).map((s) => s.etat), ['encours', 'avenir', 'avenir', 'avenir']);
  assert.equal(etapeCouranteDuMedia(barre(neuf)), 'brief');
  assert.equal(pauseDeRealisationPossible(neuf).possible, false);

  const enCours = { ...neuf, medias: ['video' as const], faites: 3, total: 12 };
  assert.deepEqual(barre(enCours).map((s) => s.etat), ['encours', 'avenir', 'avenir', 'avenir']);
  assert.equal(pauseDeRealisationPossible(enCours).possible, true);
  assert.equal(repriseDeRealisationPossible(enCours).possible, false);

  const enPause = { ...enCours, enPauseA: 1 };
  assert.equal(repriseDeRealisationPossible(enPause).possible, true);

  /* Une carte commencée avec l'ancien « genre » se lit encore. */
  const ancienne = { ...neuf, genre: 'les-deux' as const, faites: 2, total: 8 };
  assert.deepEqual(typesDeMediaDeLaRealisation(ancienne), ['image', 'video']);

  /* Le cahier terminé ne suffit pas : c'est le bouton « Passer aux esquisses » qui fait avancer. */
  const fini = { ...enCours, termineA: 2 };
  assert.equal(etapeCouranteDuMedia(barre(fini)), 'brief');
  assert.equal(etapeCouranteDuMedia(barre({ ...fini, esquissesA: 3 })), 'esquisses');
});

test('lire l’avancement : total relevé, phase inconnue refusée, terminé vide les restants', () => {
  const avant = { ...realisationNeuve(), medias: ['image' as const] };
  const lu = lireAvancementDeRealisation({ faites: 5, total: 3, phase: 'scenario', restants: ['son'] }, avant, 10);
  assert.ok(lu.ok);
  if (lu.ok) {
    assert.equal(lu.realisation.total, 5);
    assert.deepEqual(lu.realisation.medias, ['image']);
    assert.deepEqual(lu.realisation.restants, ['son']);
  }
  assert.equal(lireAvancementDeRealisation({ phase: 'moulage' }, avant, 10).ok, false);
  const fin = lireAvancementDeRealisation({ phase: 'budget', termine: true, restants: ['x'] }, avant, 11);
  assert.ok(fin.ok && fin.realisation.termineA === 11 && fin.realisation.restants.length === 0);
  const audio = lireAvancementDeRealisation({ medias: ['image', 'musique', 'voix', 'musique'] }, realisationNeuve(), 12);
  assert.ok(audio.ok && audio.realisation.medias.join() === 'image,musique,voix', 'les types se lisent, sans doublon');
  assert.equal(lireAvancementDeRealisation({ medias: ['hologramme'] }, realisationNeuve(), 12).ok, false, 'un type inconnu est refusé');
});

test('le volet : type choisi ET demande partie, avant le travail, jamais pour un cahier des charges de projet', () => {
  const partie = { ...realisationNeuve(), demandeA: 1, medias: ['video' as const] };
  assert.equal(estVoletDeRealisation({ parcours: { realisationSouhaitee: true }, column: 'planned' }), false, 'allumer seul : conversation ordinaire');
  assert.equal(estVoletDeRealisation({ parcours: { realisationSouhaitee: true }, column: 'planned', realisation: realisationNeuve() }), false, 'état neuf : rien');
  assert.equal(estVoletDeRealisation({ parcours: { realisationSouhaitee: true }, column: 'planned', realisation: partie }), true, 'premier message parti : volet');
  assert.equal(estVoletDeRealisation({ parcours: { realisationSouhaitee: true }, column: 'planned', realisation: { ...realisationNeuve(), medias: ['video'] } }), false, 'type choisi au bouton, rien d’envoyé : rien à droite');
  assert.equal(estVoletDeRealisation({ parcours: { realisationSouhaitee: true }, column: 'planned', realisation: { ...realisationNeuve(), demandeA: 1 } }), false, 'demande partie SANS type : rien à droite');
  assert.equal(estVoletDeRealisation({ parcours: { realisationSouhaitee: true }, column: 'planned', realisation: { ...realisationNeuve(), medias: ['video'], faites: 2 } }), true, 'questionnaire déjà commencé (carte d’avant)');
  assert.equal(cheminDeRealisationVisible({ parcours: { realisationSouhaitee: true }, column: 'planned', realisation: { ...realisationNeuve(), demandeA: 1 } }), false, 'sans type, aucun suivi ne s’ouvre');
  assert.equal(cheminDeRealisationVisible({ parcours: { realisationSouhaitee: true }, column: 'running', realisation: { ...realisationNeuve(), termineA: 3 } }), true, 'cahier terminé : le chemin reste');
  assert.equal(estVoletDeRealisation({ parcours: { realisationSouhaitee: true }, column: 'running', realisation: partie }), false);
  assert.equal(estVoletDeRealisation({ parcours: { realisationSouhaitee: false }, column: 'planned', realisation: partie }), false);
  assert.equal(estVoletDeRealisation({ parcours: { realisationSouhaitee: true }, column: 'planned', cahierDesCharges: {}, realisation: partie }), false);
});

test('la barre d’écriture : à toutes les étapes d’une création de média — le brief est une discussion (26/10/2026)', () => {
  const base = { parcours: { realisationSouhaitee: true }, column: 'planned' };
  const r = (o: object) => ({ ...realisationNeuve(), demandeA: 1, ...o });
  assert.equal(barreDEcritureDuVoletDeRealisation({ ...base, realisation: r({ medias: ['video'], termineA: 5 }) }), true);
  assert.equal(barreDEcritureDuVoletDeRealisation({ ...base, realisation: r({}) }), false, 'sans type de média : pas de volet, la barre ordinaire');
  assert.equal(barreDEcritureDuVoletDeRealisation({ ...base }), false, 'avant le premier envoi : pas de volet du tout, la barre ordinaire');
  assert.equal(barreDEcritureDuVoletDeRealisation({ ...base, realisation: r({ medias: ['video'] }) }), true, 'en plein brief : on discute avec le directeur');
  assert.equal(barreDEcritureDuVoletDeRealisation({ ...base, realisation: r({ medias: ['video'], enPauseA: 3 }) }), true, 'en pause : on reprend en écrivant');
  assert.equal(barreDEcritureDuVoletDeRealisation({ ...base, column: 'running', realisation: r({ medias: ['video'], termineA: 5 }) }), false, 'carte lancée');
  assert.equal(barreDEcritureDuVoletDeRealisation({ ...base, parcours: { realisationSouhaitee: false }, realisation: r({ medias: ['video'], termineA: 5 }) }), false, 'caméra éteinte');
  assert.equal(barreDEcritureDuVoletDeRealisation({ ...base, cahierDesCharges: {}, realisation: r({ medias: ['video'], termineA: 5 }) }), false, 'cahier de projet');
});

test('la barre d’écriture revient pendant que l’agent travaille, sauf sur une question en attente', () => {
  const realisation = { parcours: { realisationSouhaitee: true }, column: 'planned', realisation: { ...realisationNeuve(), demandeA: 1, medias: ['video' as const] } };
  const cahier = { column: 'planned', cahierDesCharges: { enPauseA: null } };
  /* Le cahier des charges : au repos la rangée seule, au travail la barre, une question garde la main. */
  assert.equal(barreDEcritureDuVolet(cahier, { travaille: false, questionEnAttente: false }), false, 'au repos : la rangée du volet seule');
  assert.equal(barreDEcritureDuVolet(cahier, { travaille: true, questionEnAttente: false }), true, 'agent au travail : Suspendre et envoi prioritaire');
  assert.equal(barreDEcritureDuVolet(cahier, { travaille: true, questionEnAttente: true }), false, 'question en attente : le panneau de décision répond');
  /* Une création de média : la barre toujours, sauf quand une question (un bouton « Générer · prix ») attend. */
  assert.equal(barreDEcritureDuVolet(realisation, { travaille: false, questionEnAttente: false }), true, 'au repos : on écrit au directeur');
  assert.equal(barreDEcritureDuVolet(realisation, { travaille: true, questionEnAttente: false }), true);
  assert.equal(barreDEcritureDuVolet(realisation, { travaille: false, questionEnAttente: true }), false, 'question en attente : le panneau de décision répond');
  assert.equal(barreDEcritureDuVolet({ ...cahier, cahierDesCharges: { enPauseA: 5 } }, { travaille: false, questionEnAttente: false }), true, 'cahier en pause');
  assert.equal(barreDEcritureDuVolet({ column: 'running' }, { travaille: true, questionEnAttente: false }), false, 'hors volet : sans objet');
});

test('le premier message parti ouvre le volet, une seule fois ; allumer ne l’ouvre pas', () => {
  const c = carteDeCadrage('aaaa0010');
  const allumee = q.basculerLaRealisation(c.id, 'video');
  assert.equal(estVoletDeRealisation(allumee), false, 'choisir le type seul : aucun volet');
  const notee = q.noterLaDemandeDeRealisation(c.id, 42);
  assert.equal(notee?.realisation?.demandeA, 42);
  assert.equal(estVoletDeRealisation(store.getCard(c.id)), true);
  assert.equal(q.noterLaDemandeDeRealisation(c.id, 99), null, 'déjà notée : rien ne bouge');
  const relue = lireAvancementDeRealisation({ phase: 'intention' }, store.getCard(c.id)!.realisation!, 50);
  assert.ok(relue.ok && relue.realisation.demandeA === 42, 'la réécriture du questionnaire garde la date');
  assert.equal(store.getCard(c.id)?.realisation?.demandeA, 42);
  q.basculerLaRealisation(c.id, null);
  assert.equal(q.noterLaDemandeDeRealisation(c.id, 100), null, 'caméra éteinte : rien');
});

test('le type se confirme dans la discussion (ou se demande quand il manque) : il allume le mode et s’écrit sur la carte', () => {
  const c = carteDeCadrage('aaaa0001');
  const allumee = q.basculerLaRealisation(c.id, 'image');
  assert.equal(allumee.parcours?.realisationSouhaitee, true);
  assert.equal(allumee.parcours?.planSouhaite, undefined, 'le plan n’est plus forcé : le document le remplace');
  assert.deepEqual(allumee.realisation?.medias, ['image']);
  assert.equal(store.getAgent('cadrage-aaaa0001')?.status, 'idle', 'choisir ne lance aucun tour');
  assert.equal(outilServiA('cahier_de_realisation', 'cadrage-aaaa0001'), true);
  assert.deepEqual(q.basculerLaRealisation(c.id, 'video').realisation?.medias, ['video'], 'un autre type remplace le premier');
  const consigne = consigneDeRealisationDeLaCarte(store.getCard(c.id)!, 'cadrage');
  assert.match(consigne, /A CONFIRMÉ CE QU’IL VEUT OBTENIR/);
  assert.match(consigne, /Ne le redemande pas/);
  assert.ok(!/ask_user » en choix UNIQUE \(kind « single »\), avec ces trois options/.test(consigne), 'plus de question du type');
  const ecrit = q.ecrireLaRealisation('cadrage-aaaa0001', { medias: ['son'], document: '# x', faites: 1, phase: 'intention' });
  assert.ok(ecrit.ok, ecrit.text);
  assert.deepEqual(store.getCard(c.id)?.realisation?.medias, ['video'], 'l’agent ne change pas le type choisi au bouton');
  /* Carte d'avant, mode allumé sans type : l'outil refuse et renvoie au bouton. */
  const ancienne = carteDeCadrage('aaaa0013');
  store.saveCard({ ...ancienne, parcours: { ...(ancienne.parcours ?? { plans: [] }), realisationSouhaitee: true }, realisation: realisationNeuve() });
  const refus = q.ecrireLaRealisation('cadrage-aaaa0013', { document: '# x', faites: 1, phase: 'intention' });
  assert.equal(refus.ok, false);
  assert.match(refus.text, /« production » action « type »/);
  /* DÉCISION DU 11/11/2026 (remplace DEC-411) : plus de bouton caméra — sans type, le directeur le DEMANDE dans la
     discussion, puis l'écrit par « production » action « type ». */
  const sansType = consigneDeRealisationDeLaCarte(store.getCard(ancienne.id)!, 'cadrage');
  assert.match(sansType, /N’EST PAS CHOISI/);
  assert.doesNotMatch(sansType, /bouton caméra/i);
  assert.match(sansType, /demande-le d’abord avec « ask_user »/);
});

test('la réponse, puis le document et l’avancement ; le budget se lit dans le document', async () => {
  const c = carteDeCadrage('aaaa0002');
  const choisie = choisirLesTypes('aaaa0002', 'video');
  assert.deepEqual(choisie.realisation?.medias, ['video']);
  assert.equal(choisie.realisation?.faites, 1);
  assert.match(consigneDeRealisationDeLaCarte(choisie, 'cadrage'), /VEUT OBTENIR : VIDÉO\. Ne le redemande pas/);

  const document = '# Réalisation\n\n## Intention\nVendre l’application.\n\n## Budget et seuil\nBudget total : 20 $\nSeuil d’accord par génération : 1,50 $\n';
  const ecrit = q.ecrireLaRealisation('cadrage-aaaa0002', { document, faites: 4, total: 10, phase: 'scenario', restants: ['Son'] });
  assert.ok(ecrit.ok, ecrit.text);
  const fichier = path.join(bacASable, documentDeRealisation(c.id));
  assert.equal(fs.readFileSync(fichier, 'utf8'), document);
  const apres = store.getCard(c.id)!;
  assert.equal(apres.realisation?.faites, 4);
  assert.equal(apres.realisation?.phase, 'scenario');
  assert.deepEqual(budgetDuCahier(rubriquesDuDocumentDeRealisation(document)), { budget: 20, seuil: 1.5 });
  /* Une création de média n'a plus de budget : ce qui part est ce qui a été accepté d'un clic (26/10/2026). */
  assert.deepEqual(budgetDeLaCarte(apres), { budget: 0, seuil: null });
  assert.match(consigneDeRealisationDeLaCarte({ ...apres, column: 'running' }, 'task'), /BRIEF → ESQUISSES → MONTAGE → TÉLÉCHARGEMENT/, 'le même directeur, quel que soit son rôle');
});

test('« termine » est refusé tant que le cahier est incomplet, accepté quand il est complet', async () => {
  const c = carteDeCadrage('aaaa0009');
  choisirLesTypes('aaaa0009', 'video');
  const incomplet = '## Intention\nVendre.\n\n## Budget et seuil\nBudget total : 20 $\nSeuil d’accord par génération : 2 $\n';
  const refuse = q.ecrireLaRealisation('cadrage-aaaa0009', { document: incomplet, faites: 9, total: 9, phase: 'budget', termine: true });
  assert.equal(refuse.ok, false);
  assert.match(refuse.text, /PAS terminé/);
  assert.match(refuse.text, /Plan par plan/);
  const apres = store.getCard(c.id)!;
  assert.equal(apres.realisation?.termineA, undefined, 'la carte n’est pas dite terminée');
  assert.ok((apres.realisation?.restants.length ?? 0) > 0, 'ce qui manque est relevé pour la reprise');
  assert.equal(fs.readFileSync(path.join(bacASable, documentDeRealisation(c.id)), 'utf8'), incomplet, 'le document, lui, est enregistré');

  const complet = RUBRIQUES_DE_REALISATION.map((r) =>
    r === 'Budget et seuil'
      ? `## ${r}\nBudget total : 20 $\nSeuil d’accord par génération : 2 $\nNouvelles tentatives maximales par plan : 2`
      : `## ${r}\nÉcrit pour ${r}.`,
  ).join('\n\n');
  const fini = q.ecrireLaRealisation('cadrage-aaaa0009', { document: complet, faites: 12, total: 12, phase: 'budget', termine: true });
  assert.ok(fini.ok, fini.text);
  assert.ok(store.getCard(c.id)!.realisation?.termineA);
});

test('pause et reprise touchent l’état, jamais la colonne ; éteindre garde l’état', async () => {
  const c = carteDeCadrage('aaaa0003');
  choisirLesTypes('aaaa0003', 'image');
  const pausee = await q.mettreLaRealisationEnPause(c.id);
  assert.ok(pausee.realisation?.enPauseA);
  assert.equal(pausee.column, 'planned');
  await assert.rejects(() => q.mettreLaRealisationEnPause(c.id), /déjà en pause/);
  const reprise = await q.reprendreLaRealisation(c.id);
  assert.equal(reprise.realisation?.enPauseA, undefined);

  await q.mettreLaRealisationEnPause(c.id);
  q.leverLaPauseDeRealisationSurMessage(c.id);
  assert.equal(store.getCard(c.id)?.realisation?.enPauseA, undefined, 'un message vaut reprise');

  const eteinte = q.basculerLaRealisation(c.id, null);
  assert.equal(eteinte.parcours?.realisationSouhaitee, false);
  assert.deepEqual(eteinte.realisation?.medias, ['image']);
  assert.equal(outilServiA('cahier_de_realisation', 'cadrage-aaaa0003'), false);
  const rallumee = q.basculerLaRealisation(c.id, 'image');
  assert.deepEqual(rallumee.realisation?.medias, ['image'], 'rallumée, la carte reprend où elle en était');
  assert.ok(rallumee.realisation?.faites, 'l’avancement est gardé');
});

test('un cadrage audiovisuel sans cahier écrit ne peut pas rendre sa compréhension', () => {
  const allumee = { parcours: { realisationSouhaitee: true }, realisation: {} };
  assert.equal(cahierDeRealisationManquant(allumee, false), true);
  assert.equal(cahierDeRealisationManquant(allumee, true), false, 'un document écrit lève le refus');
  assert.equal(cahierDeRealisationManquant({ ...allumee, realisation: { termineA: 5 } }, false), false, 'cahier terminé : rien à refuser');
  assert.equal(cahierDeRealisationManquant({ parcours: { realisationSouhaitee: false } }, false), false, 'mode éteint : cadrage ordinaire');
  assert.match(REFUS_COMPREHENSION_SANS_CAHIER, /cahier_de_realisation/);
});

/* ---------------- Le chemin guidé (22/10/2026) : enveloppe, aperçus, ambiance ---------------- */

const { Attachment } = await import('@beluga/shared');
const { fabriquerUnApercu, depenseDeLaCarte } = await import('../realisation.js');

function imageJointe(nom: string) {
  return store.saveAttachment(
    Attachment.parse({ id: store.newId(), alias: nom, projectId: projet.id, name: `${nom}.png`, mime: 'image/png', size: 4, sha: `sha-${nom}`, createdAt: store.now() }),
  );
}

test('l’enveloppe d’aperçus est abandonnée : jamais rappelée, et l’outil d’aperçu n’est plus servi (26/10/2026)', () => {
  q.basculerLaRealisation(carteDeCadrage('aaaa0010').id, 'video');
  const sans = q.ecrireLaRealisation('cadrage-aaaa0010', { document: '# R\n\n## Intention\nÀ voir\n', faites: 1, phase: 'intention' });
  assert.ok(sans.ok && !/enveloppe/.test(sans.text), sans.text);
  assert.equal(outilServiA('apercu_de_realisation', 'cadrage-aaaa0010'), false);
});

test('un aperçu ne part pas sans enveloppe, et jamais sans service au prix publié', async () => {
  q.basculerLaRealisation(carteDeCadrage('aaaa0011').id, 'video');
  const ctx = { agentId: 'cadrage-aaaa0011', projectId: projet.id, cardId: 'aaaa0011-0000-0000-0000-000000000000' };
  const sansConsigne = await fabriquerUnApercu(ctx, { phase: 'direction' });
  assert.equal(sansConsigne.ok, false);
  const sansService = await fabriquerUnApercu(ctx, { phase: 'direction', consigne: 'neon city at night' });
  assert.equal(sansService.ok, false);
  assert.match(sansService.text, /kie\.ai n’est pas branché|enveloppe/);
  assert.equal(depenseDeLaCarte(ctx.cardId), 0, 'rien n’est engagé sur le budget principal');
});

test('un choix en images tranché rejoint le tableau d’ambiance ; les aperçus à garder aussi', () => {
  carteDeCadrage('aaaa0012');
  choisirLesTypes('aaaa0012', 'image');
  const neon = imageJointe('neon');
  const pastel = imageJointe('pastel');
  const carte = q.retenirLesImagesChoisies(
    'cadrage-aaaa0012',
    { options: [{ label: 'Néon nocturne', image: neon.id }, { label: 'Pastel doux', image: pastel.id }, { label: 'Autre' }] },
    'Néon nocturne',
  );
  assert.deepEqual(carte?.realisation?.ambiance?.map((p) => [p.piece, p.legende]), [[neon.id, 'Néon nocturne']]);
  assert.equal(q.retenirLesImagesChoisies('agent-inconnu', { options: [{ label: 'X', image: neon.id }] }, 'X'), null);
  const garde = q.ecrireLaRealisation('cadrage-aaaa0012', { document: '# R\n', faites: 3, phase: 'personnages', ambiance: [{ piece: pastel.id, legende: 'Héroïne' }, { piece: 'inconnue' }] });
  assert.ok(garde.ok, garde.text);
  assert.deepEqual(
    store.getCard('aaaa0012-0000-0000-0000-000000000000')!.realisation!.ambiance!.map((p) => [p.piece, p.phase]),
    [[neon.id, 'intention'], [pastel.id, 'personnages']],
  );
});
