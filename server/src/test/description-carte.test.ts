import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CONSIGNE_DESCRIPTION_CARTE,
  MAX_SIGNES_DESCRIPTION,
  MIN_SIGNES_DESCRIPTION,
  composerDescription,
  contientRepereConcret,
  jugerDescription,
  partiesTrouvees,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Une carte proposée porte une VRAIE description                       */
/* ------------------------------------------------------------------ */

/*
 * L'exigence appartient à HaikoDev, pas au modèle : ces contrôles rejouent la
 * règle pure, puis vérifient que l'outil du chef refuse pour de bon une
 * proposition pauvre — sous n'importe quel moteur, puisque le refus est posé
 * au niveau de l'outil.
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'description-carte-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');
const { callTool, TOOL_DEFS } = await import('../tools.js');
const { rolePrompt } = await import('../runtime.js');

/** Une description qui tient debout : les quatre parties et un repère vu. */
const BONNE_DESCRIPTION = [
  "Constat : le tableau se fabrique dans `web/src/components/board.tsx` et la colonne « À déployer » y compte ses cartes à chaque rendu, ce qui la fait clignoter quand une carte entre.",
  'Attendu : le compte est calculé une seule fois par changement de liste, et la colonne cesse de clignoter.',
  "Limites : on ne touche ni au glisser-déposer, ni aux autres colonnes, ni aux règles de passage d'une colonne à l'autre.",
  'Vérification : rejouer `npm test` puis regarder la colonne pendant qu’une carte y entre, sur écran de téléphone.',
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

test('une bonne description passe', () => {
  const verdict = jugerDescription(BONNE_DESCRIPTION);
  assert.equal(verdict.ok, true, `refusée à tort : ${verdict.manques.join(', ')}`);
  assert.deepEqual(verdict.manques, []);
});

test('une description vide est refusée, et le gabarit est rendu', () => {
  for (const vide of ['', '   ', undefined, null]) {
    const verdict = jugerDescription(vide as any);
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.manques, ['vide']);
    assert.match(verdict.message, /Constat/);
    assert.match(verdict.message, /Vérification/);
  }
});

test('trois lignes bâclées sont refusées : trop court, et rien dedans', () => {
  const verdict = jugerDescription('Corriger le bug du tableau. Ce serait mieux. Merci.');
  assert.equal(verdict.ok, false);
  assert.ok(verdict.manques.includes('trop-courte'));
  assert.ok(verdict.manques.includes('constat'));
  assert.ok(verdict.manques.includes('verification'));
});

test('une description longue mais sans constat est refusée', () => {
  const sansConstat = [
    'Attendu : la colonne cesse de clignoter quand une carte y entre, et le compte reste juste.',
    "Limites : on ne touche ni au glisser-déposer, ni aux autres colonnes, ni aux règles de passage d'une colonne à l'autre, ni à la publication.",
    'Vérification : rejouer `npm test`, puis regarder la colonne sur un écran de téléphone pendant qu’une carte y entre et vérifier qu’elle ne saute plus.',
  ].join('\n');
  assert.ok(jugerDescription(sansConstat).signes > MIN_SIGNES_DESCRIPTION, 'le texte est bien assez long');
  const verdict = jugerDescription(sansConstat);
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.manques, ['constat']);
});

test('une reformulation de la demande, sans repère vu dans le projet, est refusée', () => {
  const sansRepere = [
    "Constat : aujourd'hui, quand une carte entre dans la colonne de droite, elle se met à sauter et le compte affiché n'est plus juste.",
    'Attendu : plus aucun saut, et un compte juste après chaque arrivée de carte.',
    "Limites : ne rien changer d'autre dans le tableau, ni dans le déplacement des cartes à la main.",
    'Vérification : regarder la colonne pendant qu’une carte y entre, sur un téléphone, et rejouer les contrôles du projet.',
  ].join('\n');
  const verdict = jugerDescription(sansRepere);
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.manques, ['sans-repere']);
});

test('un pavé est refusé lui aussi : ni trop court, ni trop long', () => {
  const pave = `${BONNE_DESCRIPTION}\n${'On détaille encore, et encore, et encore le même point. '.repeat(60)}`;
  const verdict = jugerDescription(pave);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.manques.includes('trop-longue'));
  assert.ok(verdict.signes > MAX_SIGNES_DESCRIPTION);
});

test('un repère concret se reconnaît à un fichier, une commande ou un libellé cité', () => {
  assert.equal(contientRepereConcret('le fichier server/src/tools.ts refuse la carte'), true);
  assert.equal(contientRepereConcret('rejouer npm test avant de conclure'), true);
  assert.equal(contientRepereConcret('le bouton « Tout déployer » reste éteint'), true);
  assert.equal(contientRepereConcret('il faudrait que ce soit mieux fait, en général'), false);
});

test('un mot de la bonne famille perdu dans un paragraphe ne fait pas une partie', () => {
  const trouvees = partiesTrouvees('Il faudra vérifier tout cela un jour, et constater le résultat.');
  assert.equal(trouvees.size, 0);
});

test('les quatre champs séparés sont mis en forme par HaikoDev', () => {
  const texte = composerDescription({
    constat: 'le fichier server/src/tools.ts accepte tout',
    attendu: 'il refuse une description pauvre',
    limites: 'on ne touche pas au tableau',
    verification: 'rejouer npm test',
  });
  assert.match(texte, /\*\*Constat\*\* : /);
  assert.match(texte, /\*\*Vérification\*\* : /);
});

/* ------------------------------------------------------------------ */
/* L'outil du chef refuse pour de bon                                   */
/* ------------------------------------------------------------------ */

for (const outil of ['board_create_card', 'propose_task']) {
  test(`${outil} : une description bâclée ne devient PAS une proposition`, async () => {
    const projet = projetDEssai();
    const resultat = await callTool({ projectId: projet.id } as any, outil, {
      title: 'Corriger le tableau',
      description: 'Il faudrait corriger ça.',
    });
    assert.equal(resultat.ok, false);
    assert.equal(resultat.proposal, undefined, 'rien ne doit s’afficher dans la conversation');
    assert.match(resultat.text, /REFUS/i);
    assert.match(resultat.text, /Constat/);
  });

  test(`${outil} : un titre seul est refusé`, async () => {
    const projet = projetDEssai();
    const resultat = await callTool({ projectId: projet.id } as any, outil, { title: 'Corriger le tableau' });
    assert.equal(resultat.ok, false);
    assert.equal(resultat.proposal, undefined);
  });

  test(`${outil} : une vraie description est acceptée`, async () => {
    const projet = projetDEssai();
    const resultat = await callTool({ projectId: projet.id } as any, outil, {
      title: 'Corriger le clignotement de la colonne',
      description: BONNE_DESCRIPTION,
    });
    assert.equal(resultat.ok, true, resultat.text);
    assert.equal(resultat.proposal?.description, BONNE_DESCRIPTION);
  });

  test(`${outil} : les quatre champs séparés suffisent`, async () => {
    const projet = projetDEssai();
    const resultat = await callTool({ projectId: projet.id } as any, outil, {
      title: 'Corriger le clignotement de la colonne',
      constat:
        "la colonne « À déployer » du fichier web/src/components/board.tsx recompte ses cartes à chaque rendu, et se met à clignoter quand une carte y entre",
      attendu: 'le compte ne se refait qu’au changement de liste, et la colonne reste stable',
      limites: 'ne pas toucher au glisser-déposer, ni aux autres colonnes, ni aux règles de passage',
      verification: 'rejouer npm test, puis regarder la colonne sur un écran de téléphone',
    });
    assert.equal(resultat.ok, true, resultat.text);
    assert.match(resultat.proposal?.description ?? '', /\*\*Constat\*\* : /);
  });

  test(`${outil} : le champ description dit ce qu'il attend`, () => {
    const def = TOOL_DEFS.find((t) => t.name === outil);
    const champs = (def?.inputSchema as any)?.properties ?? {};
    assert.match(String(champs.description?.description ?? ''), /Constat/);
    for (const partie of ['constat', 'attendu', 'limites', 'verification']) {
      assert.ok(partie in champs, `le champ « ${partie} » manque à ${outil}`);
    }
  });
}

/* ------------------------------------------------------------------ */
/* La même exigence sous les deux moteurs                               */
/* ------------------------------------------------------------------ */

test('le chef reçoit la MÊME consigne de description, quel que soit le moteur', () => {
  for (const isSelf of [false, true]) {
    const claude = rolePrompt('orchestrator', isSelf, 'claude');
    const codex = rolePrompt('orchestrator', isSelf, 'codex');
    assert.ok(claude.includes(CONSIGNE_DESCRIPTION_CARTE), 'consigne absente du briefing Claude');
    assert.ok(codex.includes(CONSIGNE_DESCRIPTION_CARTE), 'consigne absente du briefing Codex');
  }
});

test('la consigne ne nomme aucun outil propre à un moteur', () => {
  assert.doesNotMatch(CONSIGNE_DESCRIPTION_CARTE, /TaskCreate|TaskUpdate|update_plan|TodoWrite/);
});
