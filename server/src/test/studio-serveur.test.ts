import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LE STUDIO, CÔTÉ SERVEUR — ce qui ne doit jamais casser.
 *
 *  - une opération donne une version ; annuler et rétablir suivent le lien
 *    « parent » sans perdre de branche ; restaurer crée une version neuve ;
 *  - un dessin piégé posé par N'IMPORTE QUEL chemin est refusé, et rien n'est enregistré ;
 *  - un appel payant sans clic est refusé AVANT tout appel réseau, et seul le
 *    geste humain décide d'une dépense ;
 *  - une adresse signée de média n'ouvre que SON média, et pas après expiration ;
 *  - l'outil « studio » n'est servi qu'à l'agent attitré d'une création ;
 *  - supprimer une création emporte ses versions, sons et exports.
 *
 * Le bac à sable est posé AVANT le premier import du démon.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-'));
process.env.BELUGA_DATA = bacASable;
// Aucun modèle de traduction dans le bac à sable : la consigne passe telle quelle.
process.env.BELUGA_TRADUCTION_IDENTITE = "1";

const shared = await import('@beluga/shared');
const { Agent, Project, Card } = shared;
const store = await import('../store.js');
const studio = await import('../studio.js');
const { outilServiA, callTool } = await import('../tools.js');
const { commandeHyperframesPermise } = await import('../studio-rendu.js');

const projet = store.saveProject(Project.parse({ id: 'projet-studio', name: 'Studio Test', path: bacASable, createdAt: store.now(), updatedAt: store.now() }));

function creer() {
  const r = studio.creerCreation({ projectId: projet.id, titre: 'Essai', formats: ['9:16', '1:1'] });
  assert.ok(r.ok);
  return (r as any).creation;
}

test('une opération donne une version ; annuler et rétablir suivent leur branche', () => {
  const c = creer();
  const ajout = studio.appliquerOperationStudio(
    c.id,
    { op: 'inserer', pisteId: 'vecteurs', segment: { id: 't1', genre: 'texte', debut: 0, duree: 2, texte: 'A', taille: 80, couleur: '#fff', position: { x: 50, y: 50 } } },
    'humain',
  );
  assert.ok(ajout.ok);
  const deplace = studio.appliquerOperationStudio(c.id, { op: 'deplacer', segmentId: 't1', debut: 1 }, 'humain');
  assert.ok(deplace.ok);
  assert.equal(studio.lireCreation(c.id)!.version, 3);
  assert.ok(studio.annuler(c.id).ok);
  assert.equal(studio.lireCreation(c.id)!.version, 2);
  // Une nouvelle opération après une annulation ouvre une branche : rétablir n'y mène pas.
  assert.ok(studio.appliquerOperationStudio(c.id, { op: 'rogner', segmentId: 't1', duree: 5 }, 'humain').ok);
  assert.equal(studio.lireCreation(c.id)!.version, 4);
  assert.equal(studio.retablir(c.id).ok, false);
  assert.ok(studio.annuler(c.id).ok);
  assert.equal(studio.lireCreation(c.id)!.version, 2);
  assert.ok(studio.retablir(c.id).ok);
  assert.equal(studio.lireCreation(c.id)!.version, 4);
  // Restaurer la version 3 crée la version 5 : l'histoire reste entière.
  assert.ok(studio.restaurer(c.id, 3).ok);
  assert.equal(studio.lireCreation(c.id)!.version, 5);
  assert.equal((studio.compositionCourante(c.id)!.pistes.find((p) => p.id === 'vecteurs')!.segments[0] as any).debut, 1);
  assert.equal(studio.historique(c.id).length, 5);
});

test('un dessin piégé est refusé par tous les chemins, et rien n’est enregistré', () => {
  const c = creer();
  const avant = studio.lireCreation(c.id)!.version;
  const piege = studio.appliquerOperationStudio(
    c.id,
    {
      op: 'inserer',
      pisteId: 'vecteurs',
      segment: { id: 'd1', genre: 'dessin', debut: 0, duree: 2, gabarit: { html: '<div data-studio-id="a">x</div>', css: '', animation: 'fetch("/api/me")' }, parametres: [] },
    },
    'humain',
  );
  assert.equal(piege.ok, false);
  assert.match((piege as any).raison, /fetch/);
  assert.equal(studio.lireCreation(c.id)!.version, avant);
  // Un code qui ne se lit pas est refusé aussi, sans être exécuté.
  const syntaxe = studio.appliquerOperationStudio(
    c.id,
    { op: 'inserer', pisteId: 'vecteurs', segment: { id: 'd2', genre: 'dessin', debut: 0, duree: 2, gabarit: { html: '<b data-studio-id="b">x</b>', css: '', animation: 'tl.to(' }, parametres: [] } },
    'humain',
  );
  assert.equal(syntaxe.ok, false);
  assert.match((syntaxe as any).raison, /syntaxe/);
  // Un dessin propre passe, et la version gardée est la version NETTOYÉE.
  const propre = studio.appliquerOperationStudio(
    c.id,
    { op: 'inserer', pisteId: 'vecteurs', segment: { id: 'd3', genre: 'dessin', debut: 0, duree: 2, gabarit: { html: '<div data-studio-id="c" title="t">x<!-- note --></div>', css: '', animation: '' }, parametres: [] } },
    'humain',
  );
  assert.ok(propre.ok);
  const d = studio.compositionCourante(c.id)!.pistes.find((p) => p.id === 'vecteurs')!.segments[0] as any;
  assert.equal(d.gabarit.html, '<div data-studio-id="c" title="t">x</div>');
  assert.deepEqual(d.elements, ['c']);
});

test('une adresse signée n’ouvre que SON média, et pas après expiration', () => {
  const c = creer();
  const m = studio.ajouterMedia({ projectId: projet.id, creationId: c.id, genre: 'audio', provenance: 'voix-essai', nom: 'son' });
  const adresse = studio.adresseSigneeDuMedia(c.id, m.id);
  const u = new URL(adresse, 'http://x');
  const e = Number(u.searchParams.get('e'));
  const s = String(u.searchParams.get('s'));
  assert.ok(studio.mediaDeLAdresseSignee(c.id, m.id, e, s));
  assert.equal(studio.mediaDeLAdresseSignee(c.id, 'medautre', e, s), null);
  assert.equal(studio.mediaDeLAdresseSignee(c.id, m.id, e + 1, s), null);
  assert.equal(studio.mediaDeLAdresseSignee(c.id, m.id, e, s, e + 1), null);
});

test('l’outil « studio » n’est servi qu’à l’agent attitré d’une création', async () => {
  const c = creer();
  const carte = store.saveCard(
    Card.parse({ id: 'carte-studio', projectId: projet.id, title: 'Studio', column: 'running', position: 0, labels: [shared.LABEL_STUDIO], run: { engine: 'claude' }, createdAt: store.now(), updatedAt: store.now() }),
  );
  const agent = store.saveAgent(
    Agent.parse({ id: 'agent-studio', projectId: projet.id, role: 'task', title: 'Studio', cardId: carte.id, run: { engine: 'claude' }, status: 'idle', createdAt: store.now(), updatedAt: store.now() }),
  );
  const autre = store.saveAgent(
    Agent.parse({ id: 'agent-autre', projectId: projet.id, role: 'task', title: 'Autre', run: { engine: 'claude' }, status: 'idle', createdAt: store.now(), updatedAt: store.now() }),
  );
  assert.equal(outilServiA('studio', agent.id), false, 'sans création, l’outil reste fermé');
  studio.marquerAgentStudio(c.id, agent.id, carte.id);
  assert.equal(outilServiA('studio', agent.id), true);
  assert.equal(outilServiA('studio', autre.id), false);
  const refus = await callTool({ agentId: autre.id, projectId: projet.id, role: 'task' }, 'studio', { action: 'lire' });
  assert.equal(refus.ok, false);
  const lu = await callTool({ agentId: agent.id, projectId: projet.id, role: 'task', cardId: carte.id }, 'studio', { action: 'lire' });
  assert.ok(lu.ok, lu.text);
  assert.match(lu.text, /CRÉATION « Essai »/);
  assert.match(lu.text, /SÉLECTION À L’ÉCRAN/);
  // Toute fabrication payante passe par « realiser » : le Studio n'a plus de voie à lui.
  const devis = await callTool({ agentId: agent.id, projectId: projet.id, role: 'task', cardId: carte.id }, 'studio', { action: 'generer', genre: 'image', consigne: 'un chat' });
  assert.equal(devis.ok, false);
  assert.match(devis.text, /realiser/);
  assert.equal(studio.listerDepenses(c.id).length, 0);
  // Le directeur d'une création (rôle « cadrage ») reçoit aussi l'outil.
  store.saveAgent({ ...agent, role: 'cadrage' });
  assert.equal(outilServiA('studio', agent.id), true);
});

test('les commandes HyperFrames qui publient au-dehors sont refusées', () => {
  for (const interdite of ['publish', 'cloud', 'lambda', 'cloudrun', 'auth', 'feedback']) assert.equal(commandeHyperframesPermise(interdite), false);
  for (const permise of ['lint', 'validate', 'snapshot', 'render']) assert.equal(commandeHyperframesPermise(permise), true);
});

test('supprimer une création emporte ses versions, sons, exports et dépenses', () => {
  const c = creer();
  studio.ajouterMedia({ projectId: projet.id, creationId: c.id, genre: 'audio', provenance: 'voix-essai', nom: 'son' });
  studio.creerDepense({ projectId: projet.id, creationId: c.id, genre: 'voix', modele: 'x', plafond: 0.01, raison: 'r', details: {}, demandeePar: 'humain' });
  assert.ok(studio.supprimerCreation(c.id).ok);
  assert.equal(studio.lireCreation(c.id), null);
  assert.equal(studio.historique(c.id).length, 0);
  assert.equal(studio.listerDepenses(c.id).length, 0);
  assert.equal(studio.listerMedias(projet.id).filter((m) => m.creationId === c.id).length, 0);
});

test('« Valider la création » range un modèle ; revalider le met à jour ; il survit à sa création', async () => {
  const modeles = await import('../studio-modeles.js');
  const c = creer();
  assert.equal(modeles.validerCreationEnModele(c.id).ok, false, 'une création vide ne devient pas un modèle');
  const son = studio.ajouterMedia({ projectId: projet.id, creationId: c.id, genre: 'audio', provenance: 'voix-essai', nom: 'voix', attachmentId: 'piece-voix' });
  assert.ok(
    studio.appliquerOperationStudio(
      c.id,
      { op: 'inserer', pisteId: 'voix', segment: { id: 'v1', genre: 'voix', debut: 0, duree: 2, texte: 'Bonjour', etat: 'essai', mediaId: son.id, volume: 1 } },
      'humain',
    ).ok,
  );
  const r = modeles.validerCreationEnModele(c.id);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.nouveau, true);
  // Le son propre à la création a sa ligne au nom du modèle : le modèle ne le perd pas avec elle.
  const citeParLeModele = (r.modele.composition.pistes.find((p: any) => p.id === 'voix')!.segments[0] as any).mediaId;
  assert.notEqual(citeParLeModele, son.id);
  assert.equal(studio.lireMedia(citeParLeModele)!.categorie, `modele:${r.modele.id}`);
  assert.equal(r.modele.composition.dureeVoulue, 15);
  // Revalider : le MÊME modèle, mis à jour.
  assert.ok(studio.appliquerOperationStudio(c.id, { op: 'composition', dureeVoulue: 8 }, 'humain').ok);
  const encore = modeles.validerCreationEnModele(c.id);
  assert.ok(encore.ok);
  if (!encore.ok) return;
  assert.equal(encore.nouveau, false);
  assert.equal(encore.modele.id, r.modele.id);
  assert.equal(encore.modele.duree, 8);
  assert.equal(modeles.listerModeles(projet.id).filter((m) => m.creationId === c.id).length, 1);
  // Une création née du modèle reçoit SES sons : retirer le modèle ne la casse pas.
  const nee = modeles.creerDepuisModele(r.modele.id, 'Depuis le modèle');
  assert.ok(nee.ok);
  if (!nee.ok) return;
  const sonDeLaNee = (studio.compositionCourante(nee.creation.id)!.pistes.find((p) => p.id === 'voix')!.segments[0] as any).mediaId;
  assert.equal(studio.lireMedia(sonDeLaNee)!.creationId, nee.creation.id);
  assert.equal(studio.compositionCourante(nee.creation.id)!.dureeVoulue, 8);
  // La création source disparaît : le modèle reste, sans lien vers elle.
  assert.ok(studio.supprimerCreation(c.id).ok);
  const reste = modeles.lireModele(r.modele.id)!;
  assert.equal(reste.creationId, undefined);
  assert.ok(studio.lireMedia(citeParLeModele), 'le son du modèle survit à la création source');
  assert.ok(modeles.supprimerModele(r.modele.id).ok);
  assert.equal(studio.lireMedia(citeParLeModele), null);
  assert.ok(studio.lireMedia(sonDeLaNee), 'la création née du modèle garde son son');
});

test('LA VOIX DU PROJET : le devis ne reprend que les phrases à refaire, dans la voix du projet, jamais un « Kore » resté sur une phrase', async () => {
  const c = creer();
  studio.ecrireEspaceStudio(projet.id, { voixFinale: 'Aoede' });
  const pose = studio.appliquerOperationStudio(
    c.id,
    {
      op: 'lot',
      operations: [
        { op: 'inserer', pisteId: 'voix', segment: { id: 'vk', genre: 'voix', debut: 0, duree: 2, texte: 'Faite en Kore.', voixFinale: 'Kore', etat: 'finale', volume: 1 } },
        { op: 'inserer', pisteId: 'voix', segment: { id: 'va', genre: 'voix', debut: 2, duree: 2, texte: 'Faite en Aoede.', voixFinale: 'Aoede', etat: 'finale', volume: 1 } },
        { op: 'inserer', pisteId: 'voix', segment: { id: 've', genre: 'voix', debut: 4, duree: 2, texte: 'En essai, un vieux Kore dessus.', voixFinale: 'Kore', etat: 'essai', volume: 1 } },
      ],
    },
    'humain',
  );
  assert.ok(pose.ok);
  const { devisDesVoix, MODELE_VOIX_OPENROUTER } = await import('../studio-generation.js');
  // Seule la liste des prix répond : aucune voix ne peut partir d'ici.
  const vrai = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes('/models')) return new Response(JSON.stringify({ data: [{ id: MODELE_VOIX_OPENROUTER, pricing: { prompt: '0.0000005', completion: '0.00001' } }] }));
    throw new Error(`aucun autre appel réseau ne devait partir (${url})`);
  }) as typeof fetch;
  try {
    const r = await devisDesVoix(c.id);
    assert.ok(r.ok, (r as any).raison);
    if (!r.ok) return;
    // LES PHRASES À REFAIRE SEULES (02/11/2026) : celle faite en Kore et celle en essai ; celle déjà en Aoede garde son son.
    assert.deepEqual(r.devis.segments.map((s) => s.id), ['vk', 've']);
    assert.ok(r.devis.segments.every((s) => s.voix === 'Aoede'), JSON.stringify(r.devis.segments));
  } finally {
    globalThis.fetch = vrai;
  }
});

test('une fabrication de voix coupée par un redémarrage se solde, au lieu de rester « en cours »', async () => {
  const { rattraperVoixCoupees } = await import('../studio-generation.js');
  const c = creer();
  const d = studio.creerDepense({
    projectId: projet.id,
    creationId: c.id,
    genre: 'voix',
    modele: 'x',
    plafond: 0.01,
    raison: 'r',
    etat: 'validee',
    details: { segments: [{ id: 'a' }, { id: 'b' }], avancement: { faits: [], echecs: [], enCours: { id: shared.PRISE_ENTIERE, depuis: Date.now() } } },
    demandeePar: 'humain',
  });
  rattraperVoixCoupees();
  const apres = studio.lireDepense(d.id)!;
  assert.equal(apres.etat, 'echouee');
  // Tout ou rien : coupée avant la pose, aucune phrase n'a changé.
  assert.match(apres.erreur ?? '', /redémarrage.*avant la pose/);
});

test('UNE PRISE PAR VOIX : un seul appel pour toutes les phrases à refaire, chacune posée sur son passage du même fichier', async () => {
  const { validerVoixFinales, devisDesVoix, MODELE_VOIX_OPENROUTER } = await import('../studio-generation.js');
  const { enregistrerAcces } = await import('../coffre-fort.js');
  const cle = enregistrerAcces({ type: 'cle-api', nom: shared.NOM_FICHE_OPENROUTER_RELAIS, champs: { service: 'OpenRouter', cle: 'sk-or-essai' } });
  assert.ok(cle.ok, (cle as any).raison);
  const c = creer();
  studio.ecrireEspaceStudio(projet.id, { voixFinale: 'Aoede' });
  const phrases = ['Bienvenue dans notre atelier.', 'Chaque semaine, nous créons des vidéos.', 'La voix reste la même.', 'Les sous-titres suivent.', 'À bientôt !'];
  const pose = studio.appliquerOperationStudio(
    c.id,
    {
      op: 'lot',
      // Posées dans le désordre : la prise suit la ligne de temps, pas l'ordre d'insertion.
      operations: phrases
        .map((texte, i) => ({ op: 'inserer', pisteId: 'voix', segment: { id: `p${i}`, genre: 'voix', debut: i * 3, duree: 2.5, texte, etat: 'essai', volume: 1 } }))
        .reverse() as any,
    },
    'humain',
  );
  assert.ok(pose.ok, (pose as any).raison);
  const appels: string[] = [];
  const vrai = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/models')) return new Response(JSON.stringify({ data: [{ id: MODELE_VOIX_OPENROUTER, pricing: { prompt: '0.0000005', completion: '0.00001' } }] }));
    if (u.includes('/credits')) return new Response(JSON.stringify({ data: { total_credits: 10, total_usage: 1 } }));
    if (u.includes('/audio/speech')) {
      appels.push(JSON.parse(String(init?.body)).input);
      // 10 s de son (une onde douce) : la reconnaissance n'y trouve rien, la découpe passe au prorata.
      const pcm = Buffer.alloc(24000 * 2 * 10);
      for (let k = 0; k < pcm.length / 2; k++) pcm.writeInt16LE(Math.round(Math.sin(k / 20) * 800), k * 2);
      return new Response(pcm, { headers: { 'content-type': 'audio/pcm;rate=24000' } });
    }
    throw new Error(`appel réseau inattendu (${u})`);
  }) as typeof fetch;
  try {
    const r = await validerVoixFinales(c.id, undefined, 1);
    assert.ok(r.ok, (r as any).raison);
    if (!r.ok) return;
    for (let k = 0; k < 600 && studio.lireDepense(r.depense.id)!.etat === 'validee'; k++) await new Promise((x) => setTimeout(x, 100));
    const d = studio.lireDepense(r.depense.id)!;
    assert.equal(d.etat, 'faite', d.erreur);
    assert.equal(appels.length, 1, 'UN SEUL appel pour toute la voix');
    assert.equal(appels[0], `[French from France] ${phrases.join('\n\n')}`);
    const voix = shared.phrasesDeLaPrise(studio.compositionCourante(c.id)!);
    assert.deepEqual(voix.map((v) => v.etat), Array(5).fill('finale'));
    assert.ok(voix.every((v) => v.voixFinale === 'Aoede'));
    assert.equal(new Set(voix.map((v) => v.mediaId)).size, 1, 'toutes les phrases pointent vers le même fichier');
    const debuts = voix.map((v) => v.debutMedia ?? 0);
    for (let i = 1; i < debuts.length; i++) assert.ok(debuts[i]! > debuts[i - 1]!, `passages croissants : ${debuts}`);
    assert.ok(voix.every((v) => v.dureeAudio === 10));
    // Rien à refaire ensuite : pas de boucle de régénération.
    assert.equal(shared.phrasesARefaire(studio.compositionCourante(c.id)!, 'Aoede').length > 0, false);
    // « REFAIRE LA VOIX » (outil de l'agent) : tout est final, rien ne part tout seul — mais `refaire` redit toutes les phrases.
    const sansRefaire = await devisDesVoix(c.id);
    assert.equal(sansRefaire.ok, false);
    const devisForce = await devisDesVoix(c.id, undefined, { refaire: true });
    assert.ok(devisForce.ok, (devisForce as any).raison);
    if (!devisForce.ok) return;
    assert.deepEqual(devisForce.devis.segments.map((x) => x.id), ['p0', 'p1', 'p2', 'p3', 'p4']);
    // Le garde-fou de prix tient aussi pour le refaire : un plafond vu trop bas refuse.
    const tropBas = await validerVoixFinales(c.id, undefined, devisForce.devis.plafond / 2, { refaire: true });
    assert.equal(tropBas.ok, false);
    const mediaAvant = voix[0]!.mediaId;
    const refaite = await validerVoixFinales(c.id, undefined, devisForce.devis.plafond, { refaire: true });
    assert.ok(refaite.ok, (refaite as any).raison);
    if (!refaite.ok) return;
    for (let k = 0; k < 600 && studio.lireDepense(refaite.depense.id)!.etat === 'validee'; k++) await new Promise((x) => setTimeout(x, 100));
    assert.equal(studio.lireDepense(refaite.depense.id)!.etat, 'faite', studio.lireDepense(refaite.depense.id)!.erreur);
    assert.equal(appels.length, 2, 'la prise entière est repartie en UN appel');
    const apres = shared.phrasesDeLaPrise(studio.compositionCourante(c.id)!);
    assert.equal(new Set(apres.map((v) => v.mediaId)).size, 1);
    assert.notEqual(apres[0]!.mediaId, mediaAvant, 'toutes les phrases pointent vers la nouvelle prise');
  } finally {
    globalThis.fetch = vrai;
  }
});

test('LES PHRASES COCHÉES SEULES, CHACUNE DANS SA VOIX : les autres gardent leur son, une prise par voix', async () => {
  const { validerVoixFinales, devisDesVoix, MODELE_VOIX_OPENROUTER } = await import('../studio-generation.js');
  const { enregistrerAcces } = await import('../coffre-fort.js');
  enregistrerAcces({ type: 'cle-api', nom: shared.NOM_FICHE_OPENROUTER_RELAIS, champs: { service: 'OpenRouter', cle: 'sk-or-essai' } });
  const c = creer();
  studio.ecrireEspaceStudio(projet.id, { voixFinale: 'Aoede' });
  const phrases = ['Première phrase du film.', 'Deuxième phrase, dans une autre voix.', 'Troisième phrase pour finir.'];
  assert.ok(
    studio.appliquerOperationStudio(
      c.id,
      { op: 'lot', operations: phrases.map((texte, i) => ({ op: 'inserer', pisteId: 'voix', segment: { id: `q${i}`, genre: 'voix', debut: i * 3, duree: 2.5, texte, etat: 'essai', volume: 1 } })) as any },
      'humain',
    ).ok,
  );
  const appels: { voix: string; texte: string }[] = [];
  const vrai = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/models')) return new Response(JSON.stringify({ data: [{ id: MODELE_VOIX_OPENROUTER, pricing: { prompt: '0.0000005', completion: '0.00001' } }] }));
    if (u.includes('/credits')) return new Response(JSON.stringify({ data: { total_credits: 10, total_usage: 1 } }));
    if (u.includes('/audio/speech')) {
      const corps = JSON.parse(String(init?.body));
      appels.push({ voix: corps.voice, texte: corps.input });
      const pcm = Buffer.alloc(24000 * 2 * 6);
      for (let k = 0; k < pcm.length / 2; k++) pcm.writeInt16LE(Math.round(Math.sin(k / 20) * 800), k * 2);
      return new Response(pcm, { headers: { 'content-type': 'audio/pcm;rate=24000' } });
    }
    throw new Error(`appel réseau inattendu (${u})`);
  }) as typeof fetch;
  const attendre = async (id: string) => {
    for (let k = 0; k < 600 && studio.lireDepense(id)!.etat === 'validee'; k++) await new Promise((x) => setTimeout(x, 100));
    return studio.lireDepense(id)!;
  };
  try {
    const premiere = await validerVoixFinales(c.id, undefined, 1);
    assert.ok(premiere.ok, (premiere as any).raison);
    if (!premiere.ok) return;
    assert.equal((await attendre(premiere.depense.id)).etat, 'faite');
    const avant = shared.phrasesDeLaPrise(studio.compositionCourante(c.id)!);
    // UNE VOIX PAR PHRASE : « Kore » sur la deuxième ; une voix inconnue est écartée, une valeur vide rend la voix du projet.
    assert.ok(studio.appliquerOperationStudio(c.id, { op: 'proprietes', segmentId: 'q1', valeurs: { voixChoisie: 'Kore' } }, 'humain').ok);
    assert.ok(studio.appliquerOperationStudio(c.id, { op: 'proprietes', segmentId: 'q2', valeurs: { voixChoisie: 'Personne' } }, 'humain').ok);
    let comp = studio.compositionCourante(c.id)!;
    assert.equal((shared.trouverSegment(comp, 'q2')!.segment as any).voixChoisie, undefined);
    assert.deepEqual(
      shared.phrasesARefaire(comp, 'Aoede').map((x) => x.id),
      ['q1'],
      'seule la phrase changée de voix est à refaire',
    );
    // Le devis par défaut ne prend qu'elle ; les phrases COCHÉES priment, chacune avec sa voix.
    const parDefaut = await devisDesVoix(c.id);
    assert.ok(parDefaut.ok && parDefaut.devis.segments.map((x) => x.id).join() === 'q1', JSON.stringify(parDefaut));
    const devis = await devisDesVoix(c.id, ['q2', 'q1']);
    assert.ok(devis.ok, (devis as any).raison);
    if (!devis.ok) return;
    assert.deepEqual(
      devis.devis.segments.map((x) => [x.id, x.voix]),
      [
        ['q1', 'Kore'],
        ['q2', 'Aoede'],
      ],
    );
    const r = await validerVoixFinales(c.id, ['q1', 'q2'], devis.devis.plafond);
    assert.ok(r.ok, (r as any).raison);
    if (!r.ok) return;
    assert.equal((await attendre(r.depense.id)).etat, 'faite');
    // Deux appels de plus, un par voix ; la première phrase n'a pas été redite.
    assert.deepEqual(
      appels.slice(1).map((a) => a.voix),
      ['Kore', 'Aoede'],
    );
    assert.ok(appels.slice(1).every((a) => !a.texte.includes(phrases[0]!)));
    comp = studio.compositionCourante(c.id)!;
    const apres = shared.phrasesDeLaPrise(comp);
    assert.equal(apres[0]!.mediaId, avant[0]!.mediaId, 'la phrase non cochée garde son son');
    assert.equal(apres[1]!.voixFinale, 'Kore');
    assert.equal(apres[2]!.voixFinale, 'Aoede');
    assert.notEqual(apres[1]!.mediaId, apres[2]!.mediaId);
    assert.ok(apres.every((v) => v.etat === 'finale'));
    assert.equal(shared.phrasesARefaire(comp, 'Aoede').length > 0, false);
  } finally {
    globalThis.fetch = vrai;
  }
});

test('l’export d’une VIDÉO range la création en modèle (le même, mis à jour) ; l’export d’une image n’y touche pas', async () => {
  const modeles = await import('../studio-modeles.js');
  const { garderLeModeleAvecLExport } = await import('../studio-rendu.js');
  const c = creer();
  const posee = studio.appliquerOperationStudio(c.id, { op: 'inserer', pisteId: 'voix', segment: { id: 'v1', genre: 'voix', debut: 0, duree: 2, texte: 'Bonjour', etat: 'essai', volume: 1 } }, 'humain');
  assert.ok(posee.ok);
  const duProjet = () => modeles.listerModeles(projet.id).filter((m) => m.creationId === c.id);
  // Une image : aucun modèle.
  assert.equal(garderLeModeleAvecLExport(c.id, 'image'), false);
  assert.equal(duProjet().length, 0);
  // Une vidéo : le modèle naît.
  assert.equal(garderLeModeleAvecLExport(c.id, 'video'), true);
  assert.equal(duProjet().length, 1);
  const id = duProjet()[0]!.id;
  // Plusieurs formats dans un même lot, ou une vidéo refaite : toujours LE MÊME modèle, mis à jour.
  assert.ok(studio.appliquerOperationStudio(c.id, { op: 'composition', dureeVoulue: 9 }, 'humain').ok);
  assert.equal(garderLeModeleAvecLExport(c.id, 'video'), true);
  assert.equal(garderLeModeleAvecLExport(c.id, 'video'), true);
  assert.equal(duProjet().length, 1);
  assert.equal(duProjet()[0]!.id, id);
  assert.equal(modeles.lireModele(id)!.duree, 9);
  // Une création vide ou introuvable ne lève rien : l'export n'en dépend jamais.
  assert.equal(garderLeModeleAvecLExport(creer().id, 'video'), false);
  assert.equal(garderLeModeleAvecLExport('cre-inexistante', 'video'), false);
});

test('la voix finale posée refait l’export vidéo : format et réglages du dernier, jamais deux fois la même version', async () => {
  const { exportARefaire, refaireLExportApresLaVoix } = await import('../studio-rendu.js');
  const reglages = { fichier: 'mp4', resolution: '1080p', images: 30, qualite: 'haute', sansSon: false } as any;
  const exports = [
    { genre: 'image', format: '1:1', etat: 'pret', version: 50 },
    { genre: 'video', format: '9:16', etat: 'pret', version: 48, reglages },
    { genre: 'video', format: '16:9', etat: 'pret', version: 20 },
  ] as any[];
  // Le DERNIER export vidéo (la liste arrive du plus récent au plus ancien), pas l'image posée après.
  assert.deepEqual(exportARefaire(exports, ['1:1'], 127), { format: '9:16', reglages });
  // Sans export vidéo précédent : le premier format de la création, réglages par défaut.
  assert.deepEqual(exportARefaire([], ['1:1', '9:16'], 127), { format: '1:1' });
  // Un export vidéo de CETTE version attend déjà : rien de plus (pas de boucle, pas de doublon dans la file lourde).
  assert.equal(exportARefaire([{ genre: 'video', format: '9:16', etat: 'en-file', version: 127 }] as any[], ['9:16'], 127), null);
  assert.deepEqual(exportARefaire([{ genre: 'video', format: '9:16', etat: 'en-cours', version: 126 }] as any[], ['9:16'], 127), { format: '9:16' });
  assert.equal(exportARefaire([], [], 1), null);
  // Une création introuvable ne lève rien : la voix posée n'en dépend jamais.
  assert.equal(refaireLExportApresLaVoix('cre-inexistante'), null);
});

/** Un export « prêt » posé à la main, avec un vrai fichier sur le disque (aucun rendu). */
async function exportPret(creation: any, format: string, contenu: string, lot?: string, affiche?: string) {
  const { joindreUnFichier } = await import('../joindre-fichier.js');
  const joindre = async (nom: string, texte: string) => {
    const fichier = path.join(bacASable, `source-${Math.random().toString(36).slice(2)}-${nom}`);
    fs.writeFileSync(fichier, texte);
    const r = await joindreUnFichier({ projectId: projet.id, agentId: '', fichier, nom });
    assert.ok(r.ok);
    return (r as any).attachment.id as string;
  };
  const e = studio.creerExport({ creation, format: format as any, genre: 'video', voixEnEssai: 0, ...(lot ? { lot } : {}) });
  const attachmentId = await joindre(shared.nomDExport(creation.titre, format as any, creation.version, 'video'), contenu);
  const afficheId = affiche ? await joindre(`affiche-${format.replace(':', 'x')}.png`, affiche) : undefined;
  return studio.majExport(e.id, { etat: 'pret', progression: 1, attachmentId, ...(afficheId ? { afficheId } : {}) })!;
}

test('« Vider les anciens exports » : les finis partent avec leurs fichiers, jamais un export en cours ni le lot gardé ni une affiche encore montrée', async () => {
  const { cheminDePieceJointe } = await import('../pieces-jointes.js');
  const c = creer();
  const ancien = await exportPret(c, '9:16', 'ancienne vidéo verticale', undefined, 'affiche ancienne');
  const garde = await exportPret(c, '1:1', 'vidéo carrée du lot', 'lot-1', 'affiche du lot');
  const enCours = studio.creerExport({ creation: c, format: '9:16', genre: 'video', voixEnEssai: 0 });
  studio.majExport(enCours.id, { etat: 'en-cours', progression: 0.4 });
  const echoue = studio.creerExport({ creation: c, format: '16:9', genre: 'video', voixEnEssai: 0 });
  studio.majExport(echoue.id, { etat: 'echoue', erreur: 'x' });
  // La vignette de la création est l'affiche du DERNIER export prêt (celui du lot) ; on la pointe sur l'ancienne pour l'épreuve.
  (await import('../db.js')).getDb().prepare('UPDATE studio_creations SET affiche_id = ? WHERE id = ?').run(ancien.afficheId, c.id);
  const fichierAncien = cheminDePieceJointe(store.getAttachment(ancien.attachmentId!)!);
  const afficheAncienne = cheminDePieceJointe(store.getAttachment(ancien.afficheId!)!);
  assert.ok(fs.existsSync(fichierAncien));

  const r = studio.viderLesExports(c.id, [garde.id]);
  assert.ok(r.ok);
  assert.equal((r as any).retires, 2, 'l’ancien prêt et l’échoué');
  const restants = studio.listerExports(c.id).map((e) => e.id).sort();
  assert.deepEqual(restants, [garde.id, enCours.id].sort(), 'le lot gardé et l’export en cours restent');
  assert.equal(store.getAttachment(ancien.attachmentId!), null, 'la pièce de l’ancien export est retirée');
  assert.equal(fs.existsSync(fichierAncien), false, 'et son fichier a quitté le disque');
  assert.ok(store.getAttachment(ancien.afficheId!), 'l’affiche que la création montre encore reste');
  assert.ok(fs.existsSync(afficheAncienne));
  assert.ok(store.getAttachment(garde.attachmentId!), 'le fichier du lot gardé est intact');
  // Rien à garder : seul l'export en cours survit, et un second passage ne retire plus rien.
  assert.equal((studio.viderLesExports(c.id) as any).retires, 1);
  assert.deepEqual(studio.listerExports(c.id).map((e) => e.id), [enCours.id]);
  assert.equal((studio.viderLesExports(c.id) as any).retires, 0);
  assert.equal(studio.viderLesExports('cre-inexistante').ok, false);
});

test('« Tout télécharger » : une archive des fichiers prêts d’UNE création, refusée pour un export pas prêt ou d’ailleurs', async () => {
  const { archiveDesExports } = await import('../studio-archive.js');
  const { lireArchive } = await import('../archive-zip.js');
  const c = creer();
  const a = await exportPret(c, '9:16', 'A'.repeat(5000), 'lot-2');
  const b = await exportPret(c, '1:1', 'B'.repeat(3000), 'lot-2');
  const enFile = studio.creerExport({ creation: c, format: '16:9', genre: 'video', voixEnEssai: 0, lot: 'lot-2' });
  assert.equal(studio.lireExport(a.id)!.lot, 'lot-2', 'le lot voyage avec l’export');

  const r = archiveDesExports([a.id, b.id, a.id]);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.fichiers, ['essai-9x16-v1.mp4', 'essai-1x1-v1.mp4']);
  assert.equal(r.nom, 'essai-exports.zip');
  const destination = path.join(bacASable, 'lot.zip');
  const { pipeline } = await import('node:stream/promises');
  const [poids] = await Promise.all([r.poids, pipeline(r.flux, fs.createWriteStream(destination))]);
  assert.equal(poids, fs.statSync(destination).size, 'le poids annoncé est celui de l’archive (entête content-length)');
  const lue = await lireArchive(destination);
  assert.deepEqual(lue?.entrees, [
    { nom: 'essai-9x16-v1.mp4', octets: 5000 },
    { nom: 'essai-1x1-v1.mp4', octets: 3000 },
  ]);

  // Une image exportée au bit près comme une affiche partage SA pièce jointe : l'archive garde le nom de l'EXPORT.
  const { joindreUnFichier } = await import('../joindre-fichier.js');
  const affiche = path.join(bacASable, 'affiche-source.png');
  fs.writeFileSync(affiche, 'mêmes octets');
  const piece = (await joindreUnFichier({ projectId: projet.id, agentId: '', fichier: affiche, nom: 'essai-9x16-v1-affiche.png' })) as any;
  const image = studio.creerExport({ creation: c, format: '9:16', genre: 'image', voixEnEssai: 0, reglages: shared.lireReglagesExport({ image: 'jpg' }, '9:16') });
  studio.majExport(image.id, { etat: 'pret', progression: 1, attachmentId: piece.attachment.id });
  const avecImage = archiveDesExports([image.id]);
  assert.ok(avecImage.ok);
  if (avecImage.ok) {
    assert.deepEqual(avecImage.fichiers, ['essai-9x16-v1.jpg']);
    avecImage.flux.destroy();
  }

  const pasPret = archiveDesExports([a.id, enFile.id]);
  assert.equal(pasPret.ok, false);
  assert.match((pasPret as any).raison, /pas prêt/);
  const autre = creer();
  const ailleurs = await exportPret(autre, '9:16', 'autre création');
  const melange = archiveDesExports([a.id, ailleurs.id]);
  assert.equal(melange.ok, false);
  assert.match((melange as any).raison, /même création/);
  assert.equal((archiveDesExports([]) as any).statut, 400);
  assert.equal((archiveDesExports(['exp-inconnu']) as any).statut, 404);
});

test('la galerie du Studio lit le catalogue gelé, sans source ni téléchargement', async () => {
  const styles = await import('../studio-styles.js');
  const galerie = styles.stylesPourLaGalerie();
  assert.ok(galerie.length > 100);
  assert.ok(!('consigne' in galerie[0]!));
  assert.equal(styles.lireStyle(galerie[0]!.id)?.id, galerie[0]!.id);
  assert.ok(styles.chercherStyles('néon', 6).length <= 6);
  assert.equal((await styles.vignetteDuStyle('style-inconnu', false)).type, 'image/svg+xml');
});

test('LA COPIE D’APERÇU D’UNE VIDÉO TRANSPARENTE : fabriquée une fois, cachée de la bibliothèque, retirée avec sa vidéo', async () => {
  const { execFileSync } = await import('node:child_process');
  const { joindreUnFichier } = await import('../joindre-fichier.js');
  const { assurerLesCopiesAlpha, copieAlphaExiste } = await import('../studio-copie-alpha.js');
  const { dansLaFileLourde } = await import('../file-lourde.js');
  const c = creer();
  const fabriquer = (nom: string, lavfi: string, pix: string) => {
    const f = path.join(bacASable, nom);
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', lavfi, '-t', '0.5', '-c:v', 'libvpx-vp9', '-pix_fmt', pix, f]);
    return f;
  };
  const poser = async (fichier: string, nom: string) => {
    const j = await joindreUnFichier({ projectId: projet.id, fichier, nom });
    assert.ok(j.ok);
    return studio.ajouterMedia({ projectId: projet.id, creationId: c.id, genre: 'video', provenance: 'import', nom, attachmentId: (j as any).attachment.id, mime: 'video/webm', largeur: 64, hauteur: 128 });
  };
  const transparente = await poser(fabriquer('t.webm', 'color=green@0.5:s=64x128:r=10,format=yuva420p', 'yuva420p'), 't.webm');
  const opaque = await poser(fabriquer('o.webm', 'color=blue:s=64x128:r=10', 'yuv420p'), 'o.webm');
  const attendre = async () => {
    for (let i = 0; i < 60 && !copieAlphaExiste(transparente.id); i++) {
      await new Promise((ok) => setTimeout(ok, 200));
      await dansLaFileLourde(async () => undefined);
    }
  };
  assurerLesCopiesAlpha(c.id, projet.id, [transparente.id, opaque.id]);
  await attendre();
  assert.ok(copieAlphaExiste(transparente.id), 'la vidéo transparente a sa copie');
  await new Promise((ok) => setTimeout(ok, 300));
  assert.ok(!copieAlphaExiste(opaque.id), 'une vidéo opaque n’en reçoit pas');
  assert.ok(!studio.listerMedias(projet.id, c.id).some((m) => m.categorie?.startsWith('copie-alpha:')), 'jamais en bibliothèque');
  assert.ok(studio.supprimerMedia(transparente.id).ok);
  assert.ok(!copieAlphaExiste(transparente.id), 'la copie part avec sa vidéo');
});
