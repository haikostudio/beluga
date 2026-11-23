import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LE MODE « RÉALISATION » (bouton caméra, 18/10/2026).
 *
 *  - le budget et le seuil se lisent dans le cahier des charges, en dollars ;
 *  - rien ne part sans budget, ni au-delà ; TOUTE génération appartient à un
 *    LOT validé d'un clic (studio créatif, 24/10/2026) : la question du devis
 *    est posée AVANT tout appel au service, prix publié ou non ;
 *  - après le clic, la génération part, le fichier est rangé sous
 *    `<médias>/<projet>/<branche>/plan-v1` et joint au fil ;
 *  - l'outil n'est servi qu'à l'agent de TÂCHE d'une carte où la caméra est
 *    allumée, jamais au cadrage ;
 *  - le Studio garde ses huit services, les nouveaux s'ajoutent à côté.
 *
 * Le bac à sable et le disque factice des médias sont posés AVANT le premier
 * import du démon.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'realisation-'));
process.env.BELUGA_DATA = bacASable;
// Aucun modèle de traduction dans le bac à sable : la consigne passe telle quelle.
process.env.BELUGA_TRADUCTION_IDENTITE = "1";
process.env.BELUGA_MEDIAS = path.join(bacASable, 'disque-de-stockage', 'beluga-medias');

const shared = await import('@beluga/shared');
const {
  Agent,
  Card,
  Message,
  Project,
  SERVICES_CREATION,
  SERVICES_DE_GENERATION,
  budgetDuCahier,
  decisionDeDepense,
  dossierRelatifDesMedias,
  nomDuFichierDeMedia,
  consigneDuQuestionnaire,
  consigneDeFabrication,
  catalogueDeGeneration,
  requeteDeGeneration,
  lireCreationDeGeneration,
  lireSuiviDeGeneration,
  prixImageFal,
  RUBRIQUES_DE_REALISATION,
  PHASES_DE_REALISATION,
  LIBELLES_PHASES_DE_REALISATION,
  lacunesDuCahierDeRealisation,
} = shared;
/* fal.ai et Higgsfield sont CACHÉS depuis le 25/10/2026 (kie.ai les remplace),
   mais leur chaîne reste éprouvée : ces tests la rallument pour eux-mêmes. */
shared.fixerLesServicesCaches([]);
const store = await import('../store.js');
const { enregistrerAcces } = await import('../coffre-fort.js');
const realisation = await import('../realisation.js');
const { toolsFor, cadrageAllowList } = await import('../tools.js');
const { PATHS } = await import('../config.js');

realisation.RYTHME_REALISATION.pauseMs = 1;
const attenteNulle = async () => {};
/** L'attente de « suivre » : assez pour que la fabrication (sans pause) se termine. */
const attenteCourte = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 3000)));

const projet = store.saveProject(Project.parse({ id: 'projet-medias', name: 'Atelier Vidéo', path: bacASable, createdAt: store.now(), updatedAt: store.now() }));

function carte(id: string, parcours: Record<string, unknown>) {
  const c = store.saveCard(
    Card.parse({
      id: `carte-${id}`,
      projectId: projet.id,
      column: 'running',
      position: 1,
      title: `Pub ${id}`,
      run: { engine: 'claude', model: 'opus' },
      agentId: `agent-${id}`,
      github: { branch: `tache/pub-${id}` },
      parcours: { plans: [], ...parcours },
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );
  store.saveAgent(
    Agent.parse({ id: `agent-${id}`, projectId: projet.id, cardId: c.id, role: 'task', title: 'Agent', run: { engine: 'claude', model: 'opus' }, status: 'running', createdAt: store.now(), updatedAt: store.now() }),
  );
  return c;
}

function cahier(budget: string) {
  return { comprehension: { texte: 'x', at: store.now(), cahierDesCharges: [{ titre: 'Budget et seuil', contenu: budget }] } };
}

const ctx = (id: string) => ({ agentId: `agent-${id}`, projectId: projet.id, cardId: `carte-${id}` });

/** Un faux réseau : chaque adresse rend ce que la table dit ; tout le reste fait échouer le test. */
function reseau(table: Record<string, (init?: RequestInit) => Response>) {
  const vrai = globalThis.fetch;
  const appels: string[] = [];
  globalThis.fetch = (async (adresse: any, init?: RequestInit) => {
    const url = String(adresse);
    appels.push(url);
    const cle = Object.keys(table).find((k) => url.startsWith(k));
    if (!cle) throw new Error(`appel réseau inattendu : ${url}`);
    return table[cle]!(init);
  }) as typeof fetch;
  return { appels, rendre: () => (globalThis.fetch = vrai) };
}
const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json' } });

/** Répond à la question posée par l'outil, comme le clic de l'utilisateur. */
let rangDeReponse = 0;
function repondre(agentId: string, question: any, answer: string) {
  rangDeReponse += 1;
  store.saveMessage(Message.parse({ id: `m-reponse-${rangDeReponse}`, agentId, role: 'assistant', content: '', questions: [{ ...question, answer }], createdAt: store.now() }));
}

function brancher(service: string, nom: string) {
  const r = enregistrerAcces({ nom: `Studio — ${nom}`, type: 'cle-api', projectId: null, champs: { service: nom, cle: `cle-${service}-ABCDEFGH1234`, adresse: 'https://exemple.test' } });
  assert.ok(r.ok, JSON.stringify(r));
}

test('le budget et le seuil se lisent dans le cahier, en dollars seulement', () => {
  assert.deepEqual(budgetDuCahier([{ titre: 'Budget et seuil', contenu: 'Budget total : 25 $\nSeuil d’accord par génération : 2,50 $' }]), { budget: 25, seuil: 2.5 });
  assert.deepEqual(budgetDuCahier([{ titre: 'Budget', contenu: 'Budget total : $40\nSeuil d’accord : 3 USD' }]), { budget: 40, seuil: 3 });
  assert.deepEqual(budgetDuCahier([{ titre: 'Budget et seuil', contenu: 'Budget total : 30 €' }]), { budget: null, seuil: null });
  assert.deepEqual(budgetDuCahier(undefined), { budget: null, seuil: null });
});

test('la décision de dépense : refus sans budget ou au-delà, accord au-delà du seuil ou sans prix, libre sinon', () => {
  assert.equal(decisionDeDepense({ prix: 0.1, depense: 0, budget: null, seuil: 1 }).verdict, 'refus');
  assert.equal(decisionDeDepense({ prix: 0.1, depense: 10, budget: 10, seuil: 1 }).verdict, 'refus');
  assert.equal(decisionDeDepense({ prix: 2, depense: 9, budget: 10, seuil: 5 }).verdict, 'refus');
  assert.equal(decisionDeDepense({ prix: 2, depense: 0, budget: 10, seuil: 1 }).verdict, 'accord');
  assert.equal(decisionDeDepense({ prix: null, depense: 0, budget: 10, seuil: 1 }).verdict, 'accord');
  assert.equal(decisionDeDepense({ prix: 0.5, depense: 0, budget: 10, seuil: null }).verdict, 'accord');
  assert.equal(decisionDeDepense({ prix: 0.5, depense: 0, budget: 10, seuil: 1 }).verdict, 'libre');
});

test('le directeur reçoit les types confirmés dans la discussion et le parcours fixe en quatre étapes, sans accord global ni enveloppe', () => {
  const consigne = consigneDuQuestionnaire({ medias: ['video'], document: '/projet/docs/realisation/x.md' });
  assert.ok(consigne.includes('A CONFIRMÉ CE QU’IL VEUT OBTENIR') && consigne.includes('VIDÉO'));
  const sansType = consigneDuQuestionnaire({ document: '/projet/docs/realisation/x.md' });
  /* Le type se confirme dans la question de départ du cadrage (11/11/2026) ; s'il manque, le directeur le demande. */
  assert.match(sansType, /N’EST PAS CHOISI/);
  assert.match(sansType, /demande-le d’abord avec « ask_user »/);
  assert.doesNotMatch(consigne, /bouton caméra/i);
  assert.match(consigne, /Ne le redemande pas/);
  /* Le parcours du 26/10/2026 : quatre étapes fixes, l'utilisateur passe par le bouton du bas. */
  assert.match(consigne, /BRIEF → ESQUISSES → MONTAGE → TÉLÉCHARGEMENT/);
  assert.match(consigne, /par le BOUTON DU BAS — jamais toi/);
  assert.match(consigne, /pas de « lancer la vidéo » pendant la retouche d’une photo/);
  assert.ok(!/TROIS ARRÊTS POUR ACCORD/.test(consigne), 'plus d’arrêts du directeur');
  assert.ok(!/posée d’office : 1 \$/.test(consigne), 'plus d’enveloppe d’aperçus d’office');
  assert.ok(!/30 %/.test(consigne), 'plus de marge de réparation');
  assert.ok(!/OpenMontage/.test(consigne), 'aucune bibliothèque sous licence restrictive n’est citée comme source');
});

test('le brief pose les questions du média choisi, jamais celles d’un autre', () => {
  const musique = consigneDuQuestionnaire({ medias: ['musique'], document: '' });
  assert.match(musique, /MUSIQUE — l’usage/);
  assert.ok(!/VIDÉO — l’objectif/.test(musique), 'pas de questions de vidéo pour une musique');
  const photo = consigneDuQuestionnaire({ medias: ['image'], document: '' });
  assert.match(photo, /PHOTO \/ IMAGE — le sujet/);
  assert.ok(!/MUSIQUE — l’usage/.test(photo));
  assert.match(photo, /Pas de découpage en plans pour ce média/);
  const film = consigneDuQuestionnaire({ medias: ['video'], document: '' });
  assert.match(film, /LA VIDÉO SE TERMINE AU BRIEF PAR SON DÉCOUPAGE/);
  assert.match(film, /« Durée : <n> s »/);
});

test('chaque étape dit ce qu’elle attend : esquisses à prix validées d’un clic, deux temps pour la vidéo, le service choisi avec l’utilisateur', () => {
  const images = consigneDuQuestionnaire({ medias: ['video'], document: '', etape: 'esquisses', phase: 'images' });
  assert.match(images, /PREMIER TEMPS D’UNE VIDÉO : L’IMAGE DE CHAQUE PLAN/);
  assert.match(images, /Aucune animation/);
  assert.match(images, /« Générer · prix »/);
  assert.match(images, /UNE VALIDATION PAR PLAN, POSÉES TOUTES D’UN COUP/);
  assert.match(images, /NE T’ARRÊTE PAS/);
  assert.match(images, /clic de l’utilisateur VAUT ACCORD/);
  assert.match(images, /une génération par lot, jamais plusieurs plans ensemble/);
  assert.match(images, /Toi, tu ne valides jamais/);
  assert.match(images, /« reessai »/);
  const sequences = consigneDuQuestionnaire({ medias: ['video'], document: '', etape: 'esquisses', phase: 'sequences', son: { voix: true, musique: false } });
  assert.match(sequences, /SECOND TEMPS D’UNE VIDÉO : LES SÉQUENCES/);
  assert.match(sequences, /Propose la VOIX OFF prévue au brief/);
  assert.ok(!/Propose la MUSIQUE prévue/.test(sequences));
  const montage = consigneDuQuestionnaire({ medias: ['image'], document: '', etape: 'montage' });
  assert.match(montage, /le studio photo/);
  for (const c of [images, sequences, montage]) {
    assert.match(c, /LE SERVICE SE CHOISIT AVEC L’UTILISATEUR/);
    assert.match(c, /Higgsfield/);
    assert.match(c, /JAMAIS « codex exec »/);
  }
  assert.match(images, /JAMAIS « codex exec »/);
});

test('le départ dit les capacités branchées et les pièces à fournir', () => {
  const consigne = consigneDuQuestionnaire({ medias: ['video'], document: '/projet/docs/realisation/x.md', capacites: ['image', 'animation', 'voix'] });
  assert.match(consigne, /capacités branchées aujourd’hui : image, animation, voix/);
  assert.match(consigne, /PIÈCES À FOURNIR/);
  assert.match(consigne, /« piece_recue »/);
  assert.match(consigne, /Capacité : <capacité>/);
  const rien = consigneDuQuestionnaire({ medias: ['video'], document: '/projet/docs/realisation/x.md', capacites: [] });
  assert.match(rien, /AUCUNE \(aucun service de fabrication n’est branché/);
});

test('le directeur garde la méthode d’un directeur artistique : accroche, bible visuelle, vrais écrans, droits', () => {
  const consigne = consigneDuQuestionnaire({ medias: ['video'], document: '/projet/docs/realisation/x.md' });
  assert.match(consigne, /DIRECTEUR ARTISTIQUE/);
  assert.match(consigne, /deux premières secondes/);
  assert.match(consigne, /BIBLE VISUELLE/);
  assert.match(consigne, /LES VRAIS ÉCRANS NE SE GÉNÈRENT JAMAIS/);
  assert.match(consigne, /assiette/);
  assert.match(consigne, /zones de sécurité/);
  assert.match(consigne, /usage publicitaire/);
});

test('la fabrication suit les prompts du cahier, ne génère pas les vrais écrans, répare ses pannes et finit par l’arrêt 3', () => {
  const consigne = consigneDeFabrication({ budget: 13, seuil: 13, depense: 0, services: 'kie', prixAccorde: 10, production: 'CHAÎNE : …' });
  assert.match(consigne, /Plan par plan/);
  assert.match(consigne, /jamais inventées par un générateur/);
  assert.match(consigne, /Contrôle qualité/);
  assert.match(consigne, /RAPPORT/);
  /* Trois arrêts (25/10/2026) : plus de question entre deux plans, lots d'office, pannes réparées seules, film soumis. */
  assert.match(consigne, /prix annoncé 10\.00 \$, plafond 13\.00 \$ avec la marge de réparation de 30 %/);
  assert.match(consigne, /Aucune question entre deux plans/);
  assert.ok(!/COMBIEN de propositions faire, de 1 à 4/.test(consigne), 'plus de question du nombre de propositions');
  assert.match(consigne, /VALIDÉ D’OFFICE/);
  assert.match(consigne, /UNE PANNE SE RÉPARE SEULE, DANS LA MARGE/);
  assert.match(consigne, /« etape » = « rendu »/);
  assert.match(consigne, /action « retenir »/);
  assert.match(consigne, /L’ÉTAT DE LA PRODUCTION, LU EN BASE/);
  assert.match(consigne, /capacité « animation », « source » = l’image/);
  assert.match(consigne, /\(1\) LE MODÈLE/);
  assert.match(consigne, /ÉCART de prix/);
  assert.match(consigne, /action « lumiere »/);
  assert.match(consigne, /NUMÉROTÉES/);
});

const CAHIER_COMPLET = [
  ...RUBRIQUES_DE_REALISATION.map((r) => `## ${r}\nContenu de la rubrique ${r}.`),
].join('\n\n').replace('Contenu de la rubrique Budget et seuil.', 'Budget total : 12 $\nSeuil d’accord par génération : 2 $\nNouvelles tentatives maximales par plan : 2');

test('un cahier complet n’a aucune lacune', () => {
  assert.deepEqual(lacunesDuCahierDeRealisation(CAHIER_COMPLET), []);
});

test('un cahier incomplet dit ce qui manque : rubrique absente, rubrique à voir — plus jamais le budget', () => {
  const sansDroits = CAHIER_COMPLET.replace(/## Droits et conformité[\s\S]*?(?=\n\n## )/, '');
  assert.ok(lacunesDuCahierDeRealisation(sansDroits).some((l) => /Droits et conformité/.test(l) && /manque/.test(l)));
  const aVoir = CAHIER_COMPLET.replace('Contenu de la rubrique Son.', 'à voir');
  assert.ok(lacunesDuCahierDeRealisation(aVoir).some((l) => /« Son »/.test(l)));
  /* Le prix s'accorde à l'arrêt 2 (25/10/2026) : un budget non chiffré n'est plus une lacune. */
  const sansBudget = CAHIER_COMPLET.replace('Budget total : 12 $', 'Prix annoncé à l’arrêt 2');
  assert.deepEqual(lacunesDuCahierDeRealisation(sansBudget), []);
  assert.ok(lacunesDuCahierDeRealisation('## Intention\nQuelque chose').length >= RUBRIQUES_DE_REALISATION.length - 1);
});

test('« Sans objet : <raison> » vaut une réponse, une rubrique n’est jamais omise', () => {
  const image = CAHIER_COMPLET.replace('Contenu de la rubrique Son.', 'Sans objet : image fixe.');
  assert.deepEqual(lacunesDuCahierDeRealisation(image), []);
});

test('les phases suivent les rubriques, une pour une', () => {
  assert.equal(PHASES_DE_REALISATION.length, RUBRIQUES_DE_REALISATION.length);
  PHASES_DE_REALISATION.forEach((phase, i) => assert.equal(LIBELLES_PHASES_DE_REALISATION[phase], RUBRIQUES_DE_REALISATION[i]));
  assert.equal(PHASES_DE_REALISATION.at(-1), 'budget');
});

test('le rangement : <projet>/<branche>/<plan>-v<n>', () => {
  assert.equal(dossierRelatifDesMedias('Atelier Vidéo', 'tache/pub-été-68e365'), 'atelier-video/tache-pub-ete-68e365');
  assert.equal(nomDuFichierDeMedia('Plan 3 — arrivée', 2, 'mp4'), 'plan-3-arrivee-v2.mp4');
});

test('les médias vont sur le disque de stockage quand un essai le désigne, jamais dans le dépôt', () => {
  assert.equal(PATHS.medias, process.env.BELUGA_MEDIAS);
  assert.ok(!PATHS.medias.startsWith(path.resolve(import.meta.dirname, '../../..')));
});

test('le Studio garde ses services, kie.ai en tête ; HeyGen et ElevenLabs s’ajoutent à côté', () => {
  assert.deepEqual(
    SERVICES_CREATION.map((s) => s.id),
    ['kie', 'higgsfield', 'byteplus', 'magnific', 'krea', 'runway', 'fal', 'replicate', 'openrouter', 'meshy'],
  );
  assert.deepEqual(SERVICES_DE_GENERATION.map((s) => s.id).slice(-2), ['heygen', 'elevenlabs']);
  const capacites = new Set(catalogueDeGeneration().map((m) => m.capacite));
  for (const c of ['image', 'video', 'voix', 'son', 'musique', 'avatar']) assert.ok(capacites.has(c as any), c);
  for (const m of catalogueDeGeneration()) assert.ok(m.qualite >= 1 && m.qualite <= 5 && m.usage, m.id);
});

test('les demandes HeyGen (v3) et ElevenLabs suivent leur documentation', () => {
  const avatar = requeteDeGeneration({ service: 'heygen', id: 'avatar_iv', capacite: 'avatar' }, 'k', { consigne: 'Bonjour', format: '9:16', voix: 'v1', avatar: 'a1' })!;
  assert.equal(avatar.requete.adresse, 'https://api.heygen.com/v3/videos');
  assert.equal(avatar.requete.entetes['x-api-key'], 'k');
  assert.deepEqual((avatar.requete.corps as any).type, 'avatar');
  const suivi = lireCreationDeGeneration({ service: 'heygen', capacite: 'avatar' }, 202, { data: { video_id: 'v-9' } });
  assert.deepEqual(suivi, { etat: 'attente', suivi: 'https://api.heygen.com/v3/videos/v-9' });
  assert.deepEqual(lireSuiviDeGeneration({ service: 'heygen' }, 200, { data: { status: 'completed', video_url: 'https://x/v.mp4' } }), { etat: 'fini', url: 'https://x/v.mp4' });
  const voix = requeteDeGeneration({ service: 'elevenlabs', id: 'eleven_multilingual_v2', capacite: 'voix' }, 'k', { consigne: 'Salut', format: '16:9', voix: 'abc' })!;
  assert.equal(voix.requete.adresse, 'https://api.elevenlabs.io/v1/text-to-speech/abc');
  assert.equal(voix.requete.entetes['xi-api-key'], 'k');
  assert.equal(voix.forme, 'fichier');
  const musique = requeteDeGeneration({ service: 'elevenlabs', id: 'music_v1', capacite: 'musique' }, 'k', { consigne: 'jazz', format: '16:9', duree: 1 })!;
  assert.equal((musique.requete.corps as any).music_length_ms, 3000);
  assert.equal(prixImageFal({ unit_price: 0.04, unit: 'image' }), 0.04);
  assert.equal(prixImageFal({ unit_price: 0.04, unit: 'gpu-second' }), null);
});

test('l’outil est servi au directeur d’une carte où la caméra est allumée, au cadrage comme à la tâche (26/10/2026)', () => {
  const noms = (role: any, o: any) => toolsFor(role, o).map((t) => t.name);
  assert.ok(noms('task', { realisation: true }).includes('realiser'));
  assert.ok(!noms('task', {}).includes('realiser'));
  assert.ok(noms('cadrage', { realisation: true }).includes('realiser'), 'le directeur mène tout le parcours au cadrage');
  assert.ok(!noms('cadrage', {}).includes('realiser'), 'caméra éteinte : rien');
  assert.ok(cadrageAllowList().includes('mcp__beluga__realiser'));
});

test('caméra éteinte : l’outil refuse tout', async () => {
  carte('eteinte', {});
  const r = await realisation.realiser(ctx('eteinte'), { action: 'lister' });
  assert.equal(r.ok, false);
});

test('au brief, rien ne se fabrique ; aux esquisses, chaque génération attend son bouton à prix — aucun service appelé avant le clic', async () => {
  brancher('fal', 'fal.ai');
  carte('sans-budget', { realisationSouhaitee: true });
  const fiche = store.getCard('carte-sans-budget')!;
  store.saveCard({ ...fiche, column: 'planned' });
  const prix = reseau({ 'https://api.fal.ai/v1/models/pricing': () => json({ prices: [{ endpoint_id: 'fal-ai/flux/schnell', unit_price: 0.003, unit: 'image' }] }) });
  try {
    const auBrief = await realisation.realiser(ctx('sans-budget'), { action: 'devis', service: 'fal', modele: 'fal-ai/flux/schnell', plan: 'Affiche', consigne: 'a poster', raison: 'brouillon' });
    assert.equal(auBrief.ok, false);
    assert.match(auBrief.text, /encore au BRIEF/);
    const modelesAuBrief = await realisation.realiser(ctx('sans-budget'), { action: 'modeles', capacite: 'image' });
    assert.equal(modelesAuBrief.ok, false, 'au brief, pas de choix de modèle ni de prix');
    assert.match(modelesAuBrief.text, /AUCUNE question de modèle/);
    store.saveCard({ ...store.getCard('carte-sans-budget')!, realisation: { ...shared.realisationNeuve(), esquissesA: 1 } });
    const d = await realisation.realiser(ctx('sans-budget'), { action: 'devis', service: 'fal', modele: 'fal-ai/flux/schnell', plan: 'Affiche', consigne: 'a poster', raison: 'brouillon' });
    assert.ok(d.ok, d.text);
    assert.match(d.text, /2 devis/, 'deux brouillons au moins par génération');
    const id = /« ([^ »]+) »/.exec(d.text)![1]!;
    const g = await realisation.realiser(ctx('sans-budget'), { action: 'generer', devis: id });
    assert.ok(g.question?.devis?.bouton, 'le devis porte son bouton « Générer · prix »');
    assert.equal(g.question!.options.length, 0);
    assert.match(g.question!.question, /Générer « Affiche » \?/);
    assert.ok(prix.appels.every((u) => u.startsWith('https://api.fal.ai/v1/models/pricing')), 'seul le prix publié a été lu');
  } finally {
    prix.rendre();
  }
});

test('un devis hors lot pose la question du lot ; après « Valider le devis » : génération, fichier rangé sur le disque de stockage et joint au fil', async () => {
  carte('image', { realisationSouhaitee: true, ...cahier('Budget total : 5 $\nSeuil d’accord par génération : 1 $') });
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5c60000000049454e44ae426082', 'hex');
  const faux = reseau({
    'https://api.fal.ai/v1/models/pricing': () => json({ prices: [{ endpoint_id: 'fal-ai/flux/schnell', unit_price: 0.003, unit: 'image' }] }),
    'https://queue.fal.run/fal-ai/flux/schnell': () => json({ status_url: 'https://queue.fal.run/etat/1', response_url: 'https://queue.fal.run/resultat/1' }),
    'https://queue.fal.run/etat/1': () => json({ status: 'COMPLETED' }),
    'https://queue.fal.run/resultat/1': () => json({ images: [{ url: 'https://cdn.fal.test/image.png' }] }),
    'https://cdn.fal.test/image.png': () => new Response(png, { status: 200, headers: { 'Content-Type': 'image/png' } }),
  });
  try {
    const d = await realisation.realiser(ctx('image'), { action: 'devis', service: 'fal', modele: 'fal-ai/flux/schnell', plan: 'Affiche', consigne: 'a poster', raison: 'brouillon', format: '9:16' });
    assert.match(d.text, /🎬 Affiche ×2 — FLUX Schnell/);
    assert.match(d.text, /0\.003 \$/);
    const id = /« ([^ »]+) »/.exec(d.text)![1]!;
    const q = await realisation.realiser(ctx('image'), { action: 'generer', devis: id }, attenteNulle);
    assert.ok(q.question, 'chaque génération se valide d’un clic');
    assert.ok(shared.validationNonBloquante(q.question), 'la validation n’arrête pas l’agent : une par plan, posées d’un coup');
    assert.match(q.text, /NE T’ARRÊTE PAS/);
    assert.equal(q.question!.description, 'FLUX Schnell · 1 brouillon', 'une seule ligne de description');
    assert.match(q.question!.question, /Générer « Affiche » \?/);
    assert.equal(q.question!.devis?.total, 0.003);
    assert.equal(q.question!.devis?.lignes.length, 1);
    assert.equal(faux.appels.filter((u) => u.startsWith('https://queue.fal.run')).length, 0, 'aucun appel avant le clic');
    repondre('agent-image', q.question, 'Générer');
    const g = await realisation.realiser(ctx('image'), { action: 'generer', devis: id }, attenteNulle);
    assert.ok(g.ok, g.text);
    assert.equal(g.question, undefined, 'le lot validé part sans seconde question');
    const s = await realisation.realiser(ctx('image'), { action: 'suivre', id }, attenteCourte);
    assert.ok(s.ok, s.text);
    assert.ok(s.attachment, 'le média rejoint le fil');
    const m = realisation.mediaParId(id)!;
    assert.equal(m.etat, 'fini');
    assert.equal(m.fichier, path.join(process.env.BELUGA_MEDIAS!, 'atelier-video', 'tache-pub-image', 'affiche-v1.png'));
    assert.ok(fs.existsSync(m.fichier!));
    assert.equal(realisation.depenseDeLaCarte('carte-image'), 0.003);
    // Refaire le plan garde la première version.
    const d2 = await realisation.realiser(ctx('image'), { action: 'devis', service: 'fal', modele: 'fal-ai/flux/schnell', plan: 'Affiche', consigne: 'a better poster', raison: 'retouche' });
    const id2 = /« ([^ »]+) »/.exec(d2.text)![1]!;
    const q2 = await realisation.realiser(ctx('image'), { action: 'lot', devis_du_lot: [id2], titre: 'Retouche' });
    assert.ok(q2.question);
    repondre('agent-image', q2.question, 'Générer');
    await realisation.realiser(ctx('image'), { action: 'generer', devis: id2 }, attenteNulle);
    await realisation.realiser(ctx('image'), { action: 'suivre', id: id2 }, attenteCourte);
    assert.equal(path.basename(realisation.mediaParId(id2)!.fichier!), 'affiche-v2.png');
    assert.ok(fs.existsSync(m.fichier!));
    const page = realisation.mediasDuProjet(projet.id);
    assert.equal(page.groupes[0]!.cardId, 'carte-image');
    assert.equal(page.groupes[0]!.medias.length, 2);
    assert.equal(page.totaux.image >= 2, true);
    const liste = await realisation.realiser(ctx('image'), { action: 'lister' });
    assert.match(liste.text, /Total dépensé : 0\.006 \$ \(accepté d’un clic : 0\.006 \$\)/);
  } finally {
    faux.rendre();
  }
});

test('prix non publié : la question du devis part AVANT tout appel ; « Valider le devis » libère, « Refuser » ferme', async () => {
  brancher('elevenlabs', 'ElevenLabs');
  carte('voix', { realisationSouhaitee: true, ...cahier('Budget total : 5 $\nSeuil d’accord par génération : 1 $') });
  const piege = reseau({});
  let id = '';
  let question: any;
  try {
    const d = await realisation.realiser(ctx('voix'), { action: 'devis', service: 'elevenlabs', modele: 'eleven_multilingual_v2', plan: 'Voix off', consigne: 'Bonjour à tous', raison: 'voix naturelle', voix: 'voix-1' });
    assert.match(d.text, /prix non publié/);
    id = /« ([^ »]+) »/.exec(d.text)![1]!;
    const g = await realisation.realiser(ctx('voix'), { action: 'generer', devis: id });
    assert.ok(g.question, 'la question du devis est posée');
    question = g.question;
    assert.match(question.question, /Générer « Voix off » \?/);
    assert.equal(question.devis.sansPrix, 1);
    assert.equal(question.devis.lignes[0].prix, null);
    assert.equal(piege.appels.length, 0, 'aucun appel avant l’accord');
  } finally {
    piege.rendre();
  }
  repondre('agent-voix', question, 'Valider le devis');
  const faux = reseau({ 'https://api.elevenlabs.io/v1/text-to-speech/voix-1': () => new Response(Buffer.from('ID3fauxmp3'), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } }) });
  try {
    const g = await realisation.realiser(ctx('voix'), { action: 'generer', devis: id }, attenteNulle);
    assert.ok(g.ok && !g.question, g.text);
    const s = await realisation.realiser(ctx('voix'), { action: 'suivre', id }, attenteCourte);
    assert.ok(s.ok, s.text);
    assert.match(realisation.mediaParId(id)!.fichier!, /voix-off-v1\.mp3$/);
  } finally {
    faux.rendre();
  }

  // Un refus ferme le devis, sans appel.
  const d2 = await realisation.realiser(ctx('voix'), { action: 'devis', service: 'elevenlabs', modele: 'eleven_flash_v2_5', plan: 'Voix courte', consigne: 'Salut', raison: 'rapide', voix: 'voix-1' });
  const id2 = /« ([^ »]+) »/.exec(d2.text)![1]!;
  const q2 = (await realisation.realiser(ctx('voix'), { action: 'generer', devis: id2 })).question!;
  repondre('agent-voix', q2, 'Refuser');
  const piege2 = reseau({});
  try {
    const g = await realisation.realiser(ctx('voix'), { action: 'generer', devis: id2 });
    assert.equal(g.ok, false);
    assert.equal(realisation.mediaParId(id2)!.etat, 'refuse');
    assert.equal(piege2.appels.length, 0);
  } finally {
    piege2.rendre();
  }
});

test('une création de média n’a plus de budget : « fixer_budget » est refusé, ce qui part est ce qui a été accepté d’un clic', async () => {
  carte('budget', { realisationSouhaitee: true });
  const q = await realisation.realiser(ctx('budget'), { action: 'fixer_budget', budget: 12, seuil: 2, raison: 'six plans vidéo' });
  assert.equal(q.ok, false);
  assert.match(q.text, /plus de budget ni de plafond/);
  assert.deepEqual(realisation.budgetDeLaCarte(store.getCard('carte-budget')!), { budget: 0, seuil: null });
});

test('« chiffrer » répond dès le brief, sans dépense, et n’invente aucun prix', async () => {
  carte('chiffre', { realisationSouhaitee: true });
  const refus = await realisation.realiser(ctx('chiffre'), { action: 'chiffrer' });
  assert.equal(refus.ok, false, 'sans capacité, rien à chiffrer');
  const r = await realisation.realiser(ctx('chiffre'), { action: 'chiffrer', capacite: 'musique', duree: 24, quantites: [1, 2] });
  assert.equal(r.ok, true, 'le brief ne refuse pas cette lecture');
  assert.match(r.text, /environ .* € \(.* \$\)|prix non publié/);
  assert.doesNotMatch(r.text, /BRIEF/);
});

test('l’agent ne fait jamais changer d’étape : « monter » attend que l’utilisateur passe au montage, « ajouter » range sans rien allumer', async () => {
  carte('montage', { realisationSouhaitee: true });
  const avant = await realisation.realiser(ctx('montage'), { action: 'monter' });
  assert.equal(avant.ok, false);
  assert.match(avant.text, /« Passer au montage »/);
  assert.equal(store.getCard('carte-montage')!.realisation?.montageA, undefined);

  carte('montage-muet', { realisationSouhaitee: true });
  const fichier = path.join(bacASable, 'montage-final.mp4');
  fs.writeFileSync(fichier, Buffer.from('faux montage'));
  const range = await realisation.realiser(ctx('montage-muet'), { action: 'ajouter', chemin: fichier, plan: 'Montage final' });
  assert.equal(range.ok, true, range.text);
  assert.equal(store.getCard('carte-montage-muet')!.realisation?.montageA, undefined, 'l’étape reste celle que l’utilisateur a choisie');
});
