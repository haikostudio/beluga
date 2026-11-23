import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

/*
 * LES CARTES MARKETING VISIBLES ET LA VEILLE D'UNE CARTE (carte du 20/10/2026).
 *
 * La carte 176d3fc7 « Ouvrir Instagram » finissait sur « Facebook doit encore
 * valider le profil… relancez-moi dans une heure » : rangée en « Archivé » à la
 * fin du tour, elle disparaissait des tableaux de bord ET de la cloche. Ce qui
 * est verrouillé ici :
 *
 *  - une carte de l'atelier Marketing ne se cache que RANGÉE (`carteMarketingCachee`) ;
 *  - la carte d'un agent de volet qui finit sur une question écrite en texte reste en « En cours » ;
 *  - les règles pures de la veille (bornes, échéance, verdict, recette sans secret, profil en lecture seule) ;
 *  - une veille posée met la carte en pause SUR PLACE, et la fin du tour ne la range pas ;
 *  - un contrôle qui passe lève la veille et relance l'agent par un message ;
 *  - une panne du contrôle ne lève rien ;
 *  - l'échéance pose une vraie question, vue par la cloche, et ses trois réponses agissent ;
 *  - une carte reprise autrement (plus en pause) abandonne sa veille.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'veille-de-carte-'));
process.env.BELUGA_DATA = bacASable;

const shared = await import('@beluga/shared');
const { Agent, Card, Message, Project } = shared;
const store = await import('../store.js');
const { carteApresFinDeTour } = await import('../deplacement-carte.js');
const veilles = await import('../veille-de-carte.js');

const projet = store.saveProject(
  Project.parse({ id: 'p-veille', name: 'Veille', path: bacASable, createdAt: store.now(), updatedAt: store.now() }),
);

function carte(id: string, labels: string[] = [], extra: Record<string, unknown> = {}) {
  return store.saveCard(
    Card.parse({ id, projectId: projet.id, title: id, column: 'running', position: 0, labels, agentId: `agent-${id}`, run: { engine: 'claude' }, createdAt: store.now(), updatedAt: store.now(), ...extra }),
  );
}
function agent(cardId: string, extra: Record<string, unknown> = {}) {
  return store.saveAgent(
    Agent.parse({ id: `agent-${cardId}`, projectId: projet.id, role: 'task', title: cardId, cardId, run: { engine: 'claude' }, status: 'done', createdAt: store.now(), updatedAt: store.now(), ...extra }),
  );
}
function dire(agentId: string, content: string, at = store.now()) {
  return store.saveMessage(Message.parse({ id: store.newId(), agentId, role: 'assistant', content, createdAt: at }));
}

const FIN = { role: 'task' as const, reussi: true, trace: 'non' as const, moteurMuet: false };

/* ------------------------------------------------------------------ */
/* Un petit site qui dit « en attente », puis « validé »                */
/* ------------------------------------------------------------------ */

let reponse = 'Profil en cours de vérification';
let enPanne = false;
const site = http.createServer((_req, res) => {
  if (enPanne) {
    res.writeHead(503);
    res.end('indisponible');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<html><body><p>${reponse}</p></body></html>`);
});
await new Promise<void>((resolve) => site.listen(0, 'localhost', () => resolve()));
const adresse = `http://localhost:${(site.address() as { port: number }).port}/statut`;
test.after(() => site.close());

const relances: Array<{ agentId: string; texte: string }> = [];
veilles.remplacerLaRelance(async (agentId, texte) => {
  relances.push({ agentId, texte });
});

/* ------------------------------------------------------------------ */

test('une carte de l’atelier Marketing ne se cache que rangée', () => {
  assert.equal(shared.carteMarketingCachee({ labels: ['marketing'], column: 'running' }), false, 'en travail : visible');
  assert.equal(shared.carteMarketingCachee({ labels: ['marketing'], column: 'archived' }), true, 'rangée : dans l’atelier');
  assert.equal(shared.carteMarketingCachee({ labels: ['marketing'], column: 'planned' }), true);
  assert.equal(shared.carteMarketingCachee({ labels: [], column: 'archived' }), false, 'une carte ordinaire n’est jamais cachée');
});

test('les paquets du tableau et leurs compteurs comptent la carte marketing en travail, pas la rangée', () => {
  carte('mk-travail', ['marketing']);
  carte('mk-rangee', ['marketing'], { column: 'archived' });
  const { cards, totaux } = store.premiereTrancheDeCartes(projet.id);
  assert.ok(cards.some((c) => c.id === 'mk-travail'));
  assert.ok(!cards.some((c) => c.id === 'mk-rangee'));
  assert.equal(totaux.archived ?? 0, 0, 'le compteur dit ce que la liste montre');
  store.deleteCard('mk-travail');
  store.deleteCard('mk-rangee');
});

test('la carte d’un agent de volet qui finit sur une question en texte reste en « En cours »', () => {
  const c = carte('mk-question', ['marketing']);
  const a = agent(c.id);
  dire(a.id, 'Le compte est créé. Voulez-vous que je crée aussi la page Facebook du projet ?');
  const apres = carteApresFinDeTour(store.getCard(c.id)!, { ...FIN, agentId: a.id, attitre: true });
  assert.equal(apres.column, 'running', 'la question ne disparaît pas dans « Archivé »');

  const c2 = carte('mk-fini', ['marketing']);
  const a2 = agent(c2.id);
  dire(a2.id, 'Le plan de la semaine est déposé en brouillons.');
  const fini = carteApresFinDeTour(store.getCard(c2.id)!, { ...FIN, agentId: a2.id, attitre: true });
  assert.equal(fini.column, 'archived', 'sans question, elle retourne dans l’atelier');
});

test('les règles de la veille : bornes, échéance, verdict', () => {
  assert.equal(shared.bornerIntervalleDeVeille(1), shared.INTERVALLE_VEILLE_MIN_MS);
  assert.equal(shared.bornerIntervalleDeVeille(10_000), shared.INTERVALLE_VEILLE_MAX_MS);
  assert.equal(shared.bornerIntervalleDeVeille(undefined), shared.INTERVALLE_VEILLE_DEFAUT_MS);
  assert.equal(shared.echeanceDeVeille(0), 48 * 3_600_000);
  assert.equal(shared.echeanceDeVeille(0, 100), 48 * 3_600_000, 'jamais plus de 48 h');
  assert.equal(shared.echeanceDeVeille(0, 2), 2 * 3_600_000);
  assert.equal(shared.prochainControleDeVeille(0, 3_600_000, 1_000), 1_000, 'jamais après l’échéance');

  assert.equal(shared.issueDuVerdict({ etat: 'ok' }, 'reussite'), 'levee');
  assert.equal(shared.issueDuVerdict({ etat: 'panne', raison: 'contenu' }, 'reussite'), 'pas-encore');
  assert.equal(shared.issueDuVerdict({ etat: 'panne', raison: 'contenu' }, 'contenuAbsent'), 'levee');
  assert.equal(shared.issueDuVerdict({ etat: 'ok' }, 'contenuAbsent'), 'pas-encore');
  for (const raison of ['injoignable', 'delai', 'serveur', 'parcours'] as const) {
    assert.equal(shared.issueDuVerdict({ etat: 'panne', raison }, 'reussite'), 'panne', `${raison} ne lève rien`);
    assert.equal(shared.issueDuVerdict({ etat: 'panne', raison }, 'contenuAbsent'), 'panne');
  }
  assert.equal(shared.choixDEcheance('Prolonger la veille de 48 h'), 'prolonger');
  assert.equal(shared.choixDEcheance('Relancer l’agent'), 'relancer');
  assert.equal(shared.choixDEcheance('Abandonner'), 'abandonner');
  assert.equal(shared.choixDEcheance('peut-être'), null);
});

test('la recette d’une veille ne porte aucun secret, et un profil connecté ne fait que lire', () => {
  const secret = shared.jugerVeille({
    raison: 'Meta valide le profil',
    url: 'https://facebook.com',
    recette: { type: 'parcours', etapes: [{ action: 'aller', url: 'https://facebook.com' }, { action: 'remplir', selecteur: 'input[type=password]', valeur: 'motdepasse' }] },
  });
  assert.equal(secret.ok, false, 'un mot de passe en clair est refusé');

  const clic = shared.jugerVeille({
    raison: 'Meta valide le profil',
    url: 'https://facebook.com',
    profil: 'facebook-essai',
    recette: { type: 'parcours', etapes: [{ action: 'aller', url: 'https://facebook.com' }, { action: 'cliquer', selecteur: '#ok' }] },
  });
  assert.equal(clic.ok, false, 'un profil connecté ne clique pas');

  const lecture = shared.jugerVeille({
    raison: 'Meta valide le profil',
    url: 'https://facebook.com',
    profil: 'facebook-essai',
    leveeSi: 'contenuAbsent',
    recette: { type: 'parcours', etapes: [{ action: 'aller', url: 'https://facebook.com' }, { action: 'verifierTexte', texte: 'en cours de vérification' }] },
  });
  assert.equal(lecture.ok, true);
  assert.equal(shared.jugerVeille({ raison: 'x', url: 'https://a.ch' }).ok, false, 'il faut dire ce qu’on attend');
  assert.equal(shared.jugerVeille({ raison: 'Le domaine répond', url: 'https://a.ch', leveeSi: 'contenuAbsent' }).ok, false);
});

const RECETTE = { type: 'appel', motAttendu: 'Profil validé' };

test('une veille posée met la carte en pause sur place, et la fin du tour ne la range pas', async () => {
  const c = carte('veille-pose', ['marketing'], { scheduling: { asap: false, attempts: 0, restarts: 0, tourEnVolDepuis: store.now() } });
  const a = agent(c.id, { status: 'running' });

  enPanne = true;
  const refus = await veilles.poserVeille({ agentId: a.id, cardId: c.id, args: { raison: 'Meta valide le profil', url: adresse, recette: RECETTE } });
  assert.equal(refus.ok, false, 'un contrôle en panne ne se pose pas');
  enPanne = false;

  reponse = 'Profil validé';
  const deja = await veilles.poserVeille({ agentId: a.id, cardId: c.id, args: { raison: 'Meta valide le profil', url: adresse, recette: RECETTE } });
  assert.equal(deja.ok, false, 'un blocage déjà levé ne se pose pas : l’agent poursuit');
  reponse = 'Profil en cours de vérification';

  const essai = await veilles.poserVeille({ agentId: a.id, cardId: c.id, args: { raison: 'Meta valide le profil', url: adresse, recette: RECETTE, essai: true } });
  assert.equal(essai.ok, true);
  assert.equal(veilles.veilleDeLaCarte(c.id), null, 'un essai ne pose rien');

  const pose = await veilles.poserVeille({ agentId: a.id, cardId: c.id, args: { raison: 'Meta valide le profil', url: adresse, recette: RECETTE, intervalleMinutes: 30 } });
  assert.equal(pose.ok, true, pose.texte);
  const enPause = store.getCard(c.id)!;
  assert.equal(shared.carteEnPause(enPause.scheduling), true);
  assert.equal(enPause.veille?.etat, 'en_cours');
  assert.match(enPause.scheduling?.waitingReason ?? '', /En veille : Meta valide le profil/);

  const apres = carteApresFinDeTour(enPause, { ...FIN, agentId: a.id, attitre: true });
  assert.equal(apres.column, 'running', 'la fin du tour laisse la carte en pause, en « En cours »');
  assert.equal(apres.scheduling?.tourEnVolDepuis, undefined);
  store.saveCard(apres);
  store.saveAgent({ ...store.getAgent(a.id)!, status: 'done' });
});

test('un passage « pas encore » reporte, une panne ne lève rien, un contrôle qui passe relance l’agent', async () => {
  const v = veilles.veilleDeLaCarte('veille-pose')!;
  const t0 = store.now();
  const pasEncore = await veilles.passerLaVeille(v.id, t0);
  assert.equal(pasEncore?.etat, 'en_cours');
  assert.equal(pasEncore?.dernierControle?.issue, 'pas-encore');
  assert.equal(pasEncore?.prochainControleA, t0 + 30 * 60_000);
  assert.equal(store.getCard('veille-pose')?.veille?.dernierControle?.issue, 'pas-encore');

  enPanne = true;
  const panne = await veilles.passerLaVeille(v.id);
  enPanne = false;
  assert.equal(panne?.etat, 'en_cours', 'une panne du contrôle ne lève rien');
  assert.equal(panne?.dernierControle?.issue, 'panne');
  assert.equal(relances.length, 0, 'et ne relance personne');
  assert.equal(shared.veilleAReparer(store.getCard('veille-pose')?.veille), true, 'le bouton de réparation paraît');
  assert.equal(shared.resultatDeVerification('panne', 'injoignable').genre, 'error');
  assert.equal(shared.resultatDeVerification('pas-encore').genre, 'info');

  /* « Demander à l'agent de réparer » : seul ce clic relance l'agent, avec le détail et sans valeur saisie. */
  const reparee = await veilles.reparerLaVeille('veille-pose');
  assert.equal(reparee.ok, true);
  assert.equal(relances.length, 1);
  assert.equal(relances[0].agentId, 'agent-veille-pose');
  assert.match(relances[0].texte, /EN PANNE/);
  assert.match(relances[0].texte, /veille_poser/);
  assert.match(relances[0].texte, /statut/, 'l’adresse surveillée est citée');
  assert.equal(veilles.veilleDeLaCarte('veille-pose')?.etat, 'en_cours', 'la veille reste active');
  relances.length = 0;

  /* Rien n'est dû avant l'heure : la tournée ne joue pas cette veille. */
  assert.equal(await veilles.tourneeDesVeilles(t0 + 60_000), 0);

  /* Un contrôle qui ne tombe plus en panne retire le bouton. */
  const repart = await veilles.passerLaVeille(v.id);
  assert.equal(repart?.dernierControle?.issue, 'pas-encore');
  assert.equal(shared.veilleAReparer(store.getCard('veille-pose')?.veille), false, 'le bouton disparaît');
  assert.equal((await veilles.reparerLaVeille('veille-pose')).ok, false, 'rien à réparer');
  assert.equal(relances.length, 0);

  reponse = 'Profil validé';
  const levee = await veilles.passerLaVeille(v.id);
  assert.equal(levee?.etat, 'levee');
  assert.equal(relances.length, 1);
  assert.equal(relances[0].agentId, 'agent-veille-pose');
  assert.match(relances[0].texte, /Le blocage est levé : Meta valide le profil/);
  assert.equal(store.getCard('veille-pose')?.veille, undefined, 'le résumé quitte la carte');
  reponse = 'Profil en cours de vérification';
});

test('l’échéance pose sa question dans la cloche, et ses trois réponses agissent', async () => {
  const c = carte('veille-echue');
  const a = agent(c.id);
  const pose = await veilles.poserVeille({ agentId: a.id, cardId: c.id, args: { raison: 'Le domaine se propage', url: adresse, recette: RECETTE, dureeHeures: 1 } });
  assert.equal(pose.ok, true, pose.texte);
  const v = veilles.veilleDeLaCarte(c.id)!;

  const echue = await veilles.passerLaVeille(v.id, v.echeance + 1);
  assert.equal(echue?.etat, 'expiree');
  assert.ok(echue?.questionMessageId);
  const decision = store
    .decisionsEnAttente()
    .find((d) => d.cardId === c.id && d.genre === 'question' && !d.reglee);
  assert.ok(decision, 'la cloche voit la question, posée en base');
  assert.match(decision!.texte ?? '', /Toujours bloqué après 1 h : Le domaine se propage/);
  assert.equal(store.getCard(c.id)?.veille?.etat, 'expiree');

  /* PROLONGER : 48 h de plus, même recette. */
  await veilles.trancherLEcheance(v.id, 'Prolonger la veille de 48 h', v.echeance + 10);
  const prolongee = veilles.lireVeille(v.id)!;
  assert.equal(prolongee.etat, 'en_cours');
  assert.equal(prolongee.echeance, v.echeance + 10 + 48 * 3_600_000);

  /* ABANDONNER : la carte se termine, la pause tombe. */
  await veilles.passerLaVeille(v.id, prolongee.echeance + 1);
  await veilles.trancherLEcheance(v.id, 'Abandonner');
  assert.equal(veilles.lireVeille(v.id)?.etat, 'abandonnee');
  const terminee = store.getCard(c.id)!;
  assert.equal(terminee.column, 'to_deploy', 'une carte ordinaire se termine comme « Terminer »');
  assert.equal(shared.carteEnPause(terminee.scheduling), false);
  assert.equal(terminee.veille, undefined);
});

test('relancer à l’échéance renvoie l’agent au travail par un message', async () => {
  const c = carte('veille-relance', ['marketing']);
  const a = agent(c.id);
  await veilles.poserVeille({ agentId: a.id, cardId: c.id, args: { raison: 'Apple relit l’application', url: adresse, recette: RECETTE } });
  const v = veilles.veilleDeLaCarte(c.id)!;
  await veilles.passerLaVeille(v.id, v.echeance + 1);
  const avant = relances.length;
  await veilles.trancherLEcheance(v.id, 'Relancer l’agent');
  assert.equal(relances.length, avant + 1);
  assert.match(relances.at(-1)!.texte, /arrivée à échéance/);
});

test('une carte reprise autrement abandonne sa veille au passage suivant', async () => {
  const c = carte('veille-reprise');
  const a = agent(c.id);
  await veilles.poserVeille({ agentId: a.id, cardId: c.id, args: { raison: 'Le tiers répond', url: adresse, recette: RECETTE } });
  const v = veilles.veilleDeLaCarte(c.id)!;
  // Un message de l'utilisateur lève la pause (`replacerCarteAuDemarrage`).
  const carteReprise = store.getCard(c.id)!;
  store.saveCard({ ...carteReprise, scheduling: { ...carteReprise.scheduling!, suspendu: false, enPause: undefined } });
  await veilles.tourneeDesVeilles();
  assert.equal(veilles.lireVeille(v.id)?.etat, 'abandonnee');
  assert.equal(store.getCard(c.id)?.veille, undefined);

  // Arrêter la veille à la main : la carte reste en pause, avec la phrase de « Suspendre ».
  const c2 = carte('veille-arret');
  const a2 = agent(c2.id);
  await veilles.poserVeille({ agentId: a2.id, cardId: c2.id, args: { raison: 'Le tiers répond', url: adresse, recette: RECETTE } });
  assert.equal(veilles.arreterLaVeille(c2.id).ok, true);
  const arretee = store.getCard(c2.id)!;
  assert.equal(shared.carteEnPause(arretee.scheduling), true);
  assert.equal(arretee.scheduling?.waitingReason, shared.RAISON_SUSPENDU_EN_PAUSE);
  assert.equal(arretee.veille, undefined);
});

test('l’outil n’est servi qu’aux agents de tâche qui portent une carte', async () => {
  const { outilServiA, toolsFor } = await import('../tools.js');
  assert.equal(outilServiA('veille_poser', 'agent-veille-pose'), true);
  store.saveAgent(Agent.parse({ id: 'agent-assistant', projectId: projet.id, role: 'task', title: 'assistant', cardId: 'veille-pose', assistantGlobal: true, run: { engine: 'claude' }, status: 'done', createdAt: store.now(), updatedAt: store.now() }));
  assert.equal(outilServiA('veille_poser', 'agent-assistant'), false, 'pas l’assistant général');
  store.saveAgent(Agent.parse({ id: 'agent-sans-carte', projectId: projet.id, role: 'task', title: 'chat', run: { engine: 'claude' }, status: 'done', createdAt: store.now(), updatedAt: store.now() }));
  assert.equal(outilServiA('veille_poser', 'agent-sans-carte'), false, 'pas une conversation sans carte');
  assert.ok(!toolsFor('cadrage').some((t) => t.name === 'veille_poser'), 'pas le cadrage');
});

/* ------------------------------------------------------------------ */
/* Le service « Tâches récurrentes » (carte du 22/10/2026)              */
/* ------------------------------------------------------------------ */

test('le service lit toutes les veilles, actives et terminées, avec leur carte et leur date de fin', async () => {
  const { bus } = await import('../bus.js');
  const annonces: number[] = [];
  const desabonner = bus.subscribe((e) => {
    if (e.type === 'veilles.compte') annonces.push(e.actives);
  });
  const c = carte('veille-service');
  const a = agent(c.id);
  await veilles.poserVeille({ agentId: a.id, cardId: c.id, args: { raison: 'Apple publie la version', url: adresse, recette: RECETTE } });
  desabonner();
  assert.ok(annonces.length >= 1, 'une veille posée l’annonce aux écrans');
  assert.equal(annonces.at(-1), veilles.compterLesVeillesActives());

  const listees = veilles.listerLesVeilles();
  const active = listees.find((v) => v.cardId === c.id && v.etat === 'en_cours')!;
  assert.ok(active, 'la veille qui court est listée');
  assert.equal(active.projectId, projet.id);
  assert.equal(active.titreCarte, c.title);
  assert.equal(active.termineA, undefined, 'une veille qui court n’a pas de fin');

  // Terminée : elle reste listée, datée, et ne compte plus parmi les veilles qui courent.
  assert.equal(veilles.arreterLaVeille(c.id).ok, true);
  const arretee = veilles.listerLesVeilles().find((v) => v.id === active.id)!;
  assert.equal(arretee.etat, 'abandonnee');
  assert.equal(typeof arretee.termineA, 'number');
  assert.equal(shared.veilleActive(arretee), false);

  // Une carte supprimée ne fait pas tomber la liste.
  store.deleteCard(c.id);
  const orpheline = veilles.listerLesVeilles().find((v) => v.id === active.id)!;
  assert.equal(orpheline.projectId, null);
  assert.equal(orpheline.titreCarte, null);
});

test('la recette montrée par le service ne porte aucune valeur saisie', () => {
  const recette = {
    url: 'https://exemple.ch',
    leveeSi: 'reussite' as const,
    recette: {
      type: 'parcours' as const,
      etapes: [
        { action: 'aller' as const, url: 'https://exemple.ch/connexion' },
        { action: 'remplir' as const, selecteur: '#courriel', valeur: 'moi@exemple.ch' },
        { action: 'remplir' as const, selecteur: '#mdp', acces: { id: 'fiche', champ: 'motDePasse' } },
        { action: 'verifierTexte' as const, texte: 'Validé' },
      ],
    },
  };
  const montree = shared.recetteAffichable(recette);
  assert.doesNotMatch(JSON.stringify(montree), /moi@exemple|fiche|motDePasse/);
  assert.equal(montree.recette.type === 'parcours' && montree.recette.etapes.length, 4);
});

test('sans veille, une tâche rendue sans code part DIRECTEMENT dans « Archivé », datée et avec sa phrase', () => {
  const c = carte('rendu-sans-code', [], { scheduling: { asap: false, attempts: 0, restarts: 0, tourEnVolDepuis: store.now() } });
  const a = agent(c.id, { status: 'running' });
  const apres = carteApresFinDeTour(store.getCard(c.id)!, { ...FIN, agentId: a.id, attitre: false });
  assert.equal(apres.column, 'archived');
  assert.equal(typeof apres.doneAt, 'number', 'une carte archivée d’office porte sa date de fin');
  assert.equal(apres.sansModification, shared.RAISON_RENDU_SANS_CODE);
  assert.equal(apres.scheduling?.waitingReason, undefined);
});

test('une veille d’après déploiement laisse la carte partir « À déployer », s’arme en ligne et note sans relancer', async () => {
  const c = carte('veille-apres', [], { scheduling: { asap: false, attempts: 0, restarts: 0, tourEnVolDepuis: store.now() } });
  const a = agent(c.id, { status: 'running' });
  reponse = 'Profil en cours de vérification';
  const pose = await veilles.poserVeille({ agentId: a.id, cardId: c.id, args: { raison: 'Le site montre la nouvelle page', url: adresse, recette: RECETTE, moment: 'apres-deploiement' } });
  assert.equal(pose.ok, true, pose.texte);
  assert.match(pose.texte, /APRÈS LE DÉPLOIEMENT/);
  const posee = store.getCard(c.id)!;
  assert.equal(shared.carteEnPause(posee.scheduling), false, 'aucune pause : le travail est fini');
  assert.equal(posee.veille?.etat, 'attend_deploiement');
  assert.equal(posee.veille?.moment, 'apres-deploiement');
  assert.equal(shared.veilleTientLaRangee(posee.veille, false), false);

  const apres = carteApresFinDeTour(posee, { ...FIN, agentId: a.id, attitre: false });
  /* Même sans code (trace « non »), la carte passe par « À déployer » : sa veille ne s'arme qu'en ligne. */
  assert.equal(apres.column, 'to_deploy', 'la fin du tour range la carte normalement');
  assert.equal(apres.sansModification, undefined, 'aucune phrase d’archivage sur une carte qui n’est pas archivée');
  store.saveCard(apres);
  store.saveAgent({ ...store.getAgent(a.id)!, status: 'done' });

  /* Pas encore en ligne : la tournée ne l'arme pas et ne l'abandonne pas. */
  await veilles.tourneeDesVeilles();
  assert.equal(veilles.veilleDeLaCarte(c.id)?.etat, 'attend_deploiement');

  /* En ligne : armée, ses 48 h comptées de là. */
  store.saveCard({ ...store.getCard(c.id)!, deployedAt: store.now() });
  const t0 = store.now();
  assert.equal(veilles.armerLesVeillesEnLigne(t0, c.id), 1);
  const armee = veilles.veilleDeLaCarte(c.id)!;
  assert.equal(armee.etat, 'en_cours');
  assert.equal(armee.creeA, t0);
  assert.equal(armee.echeance, t0 + 48 * 3_600_000);

  /* Le contrôle passe : noté dans le fil, aucune relance, la carte ne bouge pas. */
  const avant = relances.length;
  reponse = 'Profil validé';
  const levee = await veilles.passerLaVeille(armee.id);
  reponse = 'Profil en cours de vérification';
  assert.equal(levee?.etat, 'levee');
  assert.equal(relances.length, avant, 'aucune relance de l’agent');
  assert.equal(store.getCard(c.id)?.column, 'to_deploy');
  assert.equal(store.getCard(c.id)?.veille, undefined);
  const note = store.listMessages(a.id).at(-1);
  assert.match(note?.content ?? '', /Contrôle passé après la mise en ligne/);
});

test('une veille d’après déploiement s’abandonne si la carte revient « À déployer », et son échéance ne propose pas de relancer', async () => {
  const c = carte('veille-apres-retour');
  const a = agent(c.id);
  await veilles.poserVeille({ agentId: a.id, cardId: c.id, args: { raison: 'La page répond', url: adresse, recette: RECETTE, moment: 'apres-deploiement', dureeHeures: 1 } });
  store.saveCard({ ...store.getCard(c.id)!, column: 'to_deploy', deployedAt: store.now() });
  veilles.armerLesVeillesEnLigne(store.now(), c.id);
  const v = veilles.veilleDeLaCarte(c.id)!;
  assert.equal(v.etat, 'en_cours');

  const echue = await veilles.passerLaVeille(v.id, v.echeance + 1);
  assert.equal(echue?.etat, 'expiree');
  const question = store.getMessage(echue!.questionMessageId!)!.questions[0]!;
  assert.deepEqual(question.options.map((o) => o.label).some((l) => /^Relancer/i.test(l)), false);
  assert.equal((await veilles.trancherLEcheance(v.id, 'Relancer')).ok, false);
  await veilles.trancherLEcheance(v.id, 'Abandonner');
  assert.equal(veilles.lireVeille(v.id)?.etat, 'abandonnee');
  assert.equal(store.getCard(c.id)?.column, 'to_deploy', 'abandonner ne déplace pas une carte déjà rangée');

  /* Une autre, armée puis carte revenue « À déployer » (date de mise en ligne retirée) : abandonnée au passage. */
  const c2 = carte('veille-apres-revenue');
  const a2 = agent(c2.id);
  await veilles.poserVeille({ agentId: a2.id, cardId: c2.id, args: { raison: 'La page répond', url: adresse, recette: RECETTE, moment: 'apres-deploiement' } });
  store.saveCard({ ...store.getCard(c2.id)!, column: 'archived', deployedAt: store.now() });
  veilles.armerLesVeillesEnLigne(store.now(), c2.id);
  const v2 = veilles.veilleDeLaCarte(c2.id)!;
  assert.equal(v2.etat, 'en_cours');
  store.saveCard({ ...store.getCard(c2.id)!, column: 'to_deploy', deployedAt: undefined });
  assert.equal((await veilles.passerLaVeille(v2.id))?.etat, 'abandonnee');
  assert.equal(relances.filter((r) => r.agentId === a2.id).length, 0);
});
