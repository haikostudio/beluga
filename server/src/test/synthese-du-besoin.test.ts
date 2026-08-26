import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* LA SYNTHÈSE DU BESOIN VOYAGE JUSQU'AU FIL DE L'AGENT                 */
/* ------------------------------------------------------------------ */

/*
 * Le chef d'orchestre discute longuement avant qu'une carte existe. Ce qu'il en
 * retient ne doit plus mourir dans SA conversation : la carte le porte, et il
 * ouvre le fil de l'agent — visible avant même le lancement.
 *
 * Le contrôle suit le trajet entier sur une base jetable : l'outil refuse une
 * carte sans synthèse, la proposition la transporte, la carte la garde, le fil
 * s'ouvre dessus, et le bloc du prompt de lancement la reprend mot pour mot.
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'synthese-besoin-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');
const { callTool, createCard } = await import('../tools.js');
const {
  jugerSynthese,
  blocDeSyntheseDuBesoin,
  messageDeSynthese,
  idDuMessageDeSynthese,
  estLeMessageDeSynthese,
  syntheseDeSecours,
  filAvecLaSynthese,
  MIN_SIGNES_SYNTHESE,
} = await import('@haikodev/shared');

const DESCRIPTION = [
  'Constat : `web/src/components/card-panel.tsx` ouvre la conversation d’une carte sur un fil vide.',
  'Attendu : le fil s’ouvre sur la synthèse du besoin, avant même le lancement.',
  'Limites : ne toucher ni au tableau, ni aux branches, ni au geste de lancement.',
  'Vérification : rejouer `npm test`, puis ouvrir une carte fraîchement validée.',
].join('\n');

const SYNTHESE = [
  "L'utilisateur discute longuement avec le chef d'orchestre avant qu'une carte existe : captures d'écran, contraintes, refus successifs.",
  "Il constate que l'agent chargé de la carte ne reçoit qu'un titre court et trois phrases, et repart donc d'une version appauvrie du besoin.",
  'Il veut que tout ce contexte soit déposé en premier message de la conversation de la carte, lisible avant le lancement.',
  "Le chef continue d'écrire un titre court et de choisir un niveau : la synthèse s'ajoute, elle ne les remplace pas.",
].join('\n');

function projetDEssai() {
  return store.saveProject({
    id: store.newId(),
    name: 'Projet d’essai',
    path: bacASable,
    defaultEngine: 'claude',
    isSelf: false,
    archived: false,
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
}

/* ---- La règle pure ----------------------------------------------- */

test('une synthèse absente, trop courte ou renvoyée au fil est refusée', () => {
  assert.equal(jugerSynthese(undefined).ok, false);
  assert.equal(jugerSynthese('   ').ok, false);
  assert.equal(jugerSynthese('Trois mots.').ok, false);
  assert.match(jugerSynthese('Trois mots.').message, /synthèse/i);

  const renvoi = 'Il faut reprendre ce qui a été discuté avec l’utilisateur. '.repeat(6);
  assert.ok(renvoi.length > MIN_SIGNES_SYNTHESE);
  assert.equal(jugerSynthese(renvoi).ok, false, 'renvoyer au fil ne remplace pas une synthèse');
});

test('une vraie synthèse est acceptée, et se relit telle quelle', () => {
  const verdict = jugerSynthese(SYNTHESE);
  assert.equal(verdict.ok, true, verdict.message);
  assert.equal(messageDeSynthese(SYNTHESE), SYNTHESE);
  assert.equal(messageDeSynthese('  '), undefined);
});

test('le bloc du prompt reprend la synthèse mot pour mot, et rien sans elle', () => {
  const bloc = blocDeSyntheseDuBesoin(SYNTHESE);
  assert.ok(bloc.includes(SYNTHESE), 'le texte doit voyager entier jusqu’à l’agent');
  assert.match(bloc, /premier message de ta conversation/);
  assert.equal(blocDeSyntheseDuBesoin(undefined), '');
});

test('le message d’ouverture porte un identifiant stable, reconnu à l’affichage', () => {
  const id = idDuMessageDeSynthese('carte-42');
  assert.equal(id, idDuMessageDeSynthese('carte-42'), 'deux ouvertures, un seul message');
  assert.equal(estLeMessageDeSynthese(id), true);
  assert.equal(estLeMessageDeSynthese('msg-ordinaire'), false);
});

test('le fil d’une carte s’ouvre sur sa synthèse, même sans le moindre agent', () => {
  const carte = { id: 'carte-7', briefing: SYNTHESE, agentId: undefined, createdAt: 1_700_000_000_000 };
  const fil = filAvecLaSynthese(carte as any, []);
  assert.equal(fil.length, 1, 'une carte jamais lancée montre déjà son contexte');
  assert.equal(fil[0].id, idDuMessageDeSynthese('carte-7'));
  assert.equal(fil[0].content, SYNTHESE);
  assert.equal(fil[0].role, 'user');

  // Rejouer l'ouverture ne double PAS la bulle : l'identifiant est le même.
  assert.equal(filAvecLaSynthese(carte as any, [])[0].id, fil[0].id);

  // Les messages de l'agent viennent APRÈS, dans leur ordre.
  const avecReponse = filAvecLaSynthese(carte as any, [
    { id: 'm1', agentId: 'a1', role: 'assistant', content: 'Je démarre.', createdAt: 1_700_000_100_000 } as any,
  ]);
  assert.deepEqual(
    avecReponse.map((message) => message.id),
    [idDuMessageDeSynthese('carte-7'), 'm1'],
  );

  // Une carte sans synthèse garde son fil intact — rien n'est inventé.
  assert.deepEqual(filAvecLaSynthese({ ...carte, briefing: undefined } as any, []), []);
});

/* ---- Le trajet réel : outil, proposition, carte -------------------- */

test('une carte proposée sans synthèse est refusée, avec le gabarit', async () => {
  const projet = projetDEssai();
  for (const outil of ['board_create_card', 'propose_task']) {
    const resultat = await callTool({ projectId: projet.id, role: 'orchestrator' } as any, outil, {
      title: 'Porter la synthèse jusqu’à l’agent',
      description: 'Le chef doit transmettre tout ce qui s’est dit avant la carte, pas seulement le titre.',
      niveau: 'standard',
    });
    assert.equal(resultat.ok, false, `${outil} doit refuser une carte sans synthèse`);
    assert.equal(resultat.proposal, undefined, 'rien ne s’affiche dans la conversation');
    assert.match(resultat.text, /contexte/);
  }
});

test('la proposition transporte la synthèse, et la carte validée la garde', async () => {
  const projet = projetDEssai();
  const resultat = await callTool({ projectId: projet.id, role: 'orchestrator' } as any, 'board_create_card', {
    title: 'Porter la synthèse jusqu’à l’agent',
    description: 'Le chef doit transmettre tout ce qui s’est dit avant la carte, pas seulement le titre.',
    contexte: SYNTHESE,
    niveau: 'standard',
  });
  assert.equal(resultat.ok, true, resultat.text);
  assert.equal(resultat.proposal?.briefing, SYNTHESE);

  // Ce que fait `proposal.decide` au clic de l'utilisateur.
  const carte = createCard(projet.id, {
    title: resultat.proposal!.title,
    description: resultat.proposal!.description,
    origin: 'agent',
    briefing: resultat.proposal!.briefing,
  });
  assert.equal(store.getCard(carte.id)?.briefing, SYNTHESE, 'la synthèse survit à l’enregistrement');
});

test('la synthèse de SECOURS passe, quand c’est le démon qui pose la carte', async () => {
  const projet = projetDEssai();
  const texteDuChef = 'Je crée la carte : corriger le clignotement de la colonne « À déployer », niveau standard.';
  const resultat = await callTool({ projectId: projet.id, role: 'orchestrator' } as any, 'board_create_card', {
    title: 'Corriger le clignotement de la colonne',
    description: DESCRIPTION,
    contexte: syntheseDeSecours(texteDuChef),
    secours: true,
    niveau: 'standard',
  });
  assert.equal(resultat.ok, true, resultat.text);
  assert.ok(resultat.proposal?.briefing?.includes(texteDuChef), 'la réponse du chef tient lieu de contexte');
});

test('le champ « contexte » est exigé par le schéma des deux outils', async () => {
  const { TOOL_DEFS } = await import('../tools.js');
  for (const nom of ['board_create_card', 'propose_task']) {
    const schema = TOOL_DEFS.find((outil) => outil.name === nom)!.inputSchema as any;
    assert.ok(schema.required.includes('contexte'), `${nom} doit exiger la synthèse`);
    assert.match(schema.properties.contexte.description, /PREMIER MESSAGE/);
  }
});
