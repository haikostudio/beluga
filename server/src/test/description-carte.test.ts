import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CONSIGNE_CARTE_COURTE,
  CONSIGNE_DESCRIPTION_CARTE,
  MAX_SIGNES_DESCRIPTION,
  MIN_SIGNES_CARTE_COURTE,
  MIN_SIGNES_DESCRIPTION,
  composerDescription,
  contientRepereConcret,
  jugerDescription,
  partiesTrouvees,
  renvoieAuFil,
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

/** Une synthèse du besoin qui tient debout : l'échange, résumé pour l'agent. */
const SYNTHESE = [
  "L'utilisateur voit la colonne « À déployer » clignoter dès qu'une carte y entre, et cela le gêne depuis plusieurs jours.",
  'Il a précisé que le défaut se voit surtout sur son téléphone, moins sur son écran d’ordinateur.',
  "Il ne veut toucher à rien d'autre : ni au glisser-déposer, ni aux autres colonnes.",
  "Il accepte que le compte soit légèrement en retard, du moment que la colonne cesse de sauter.",
].join('\n');

/**
 * Une carte de TRI : la demande reformulée, sans partie annoncée ni repère
 * concret — le chef n'a pas ouvert le projet, il n'a rien à citer.
 */
const CARTE_COURTE =
  'Rendre la colonne « À déployer » stable quand une carte y entre : aujourd’hui elle clignote, ' +
  'et cela gêne la lecture du tableau au moment du déploiement.';

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

test('un texte d’intro se pose en tête, avant le Constat, sans intertitre', () => {
  const texte = composerDescription({
    intro: 'Ce carnet de règles grossissait toujours au même endroit : on le range mieux.',
    constat: 'le fichier server/src/tools.ts accepte tout',
    attendu: 'il refuse une description pauvre',
    limites: 'on ne touche pas au tableau',
    verification: 'rejouer npm test',
  });
  assert.match(texte, /^Ce carnet de règles grossissait/, 'l’intro ouvre la description');
  assert.doesNotMatch(texte.split('\n\n')[0], /\*\*/, 'l’intro ne porte pas son propre intertitre');
  assert.match(texte, /\*\*Constat\*\* : /, 'le Constat technique suit, inchangé');
});

/* ------------------------------------------------------------------ */
/* L'outil du chef refuse pour de bon                                   */
/* ------------------------------------------------------------------ */

for (const outil of ['board_create_card', 'propose_task']) {
  test(`${outil} : une description bâclée ne devient PAS une proposition`, async () => {
    const projet = projetDEssai();
    const resultat = await callTool({ projectId: projet.id, role: 'cadrage' } as any, outil, {
      title: 'Corriger le tableau',
      description: 'Il faudrait corriger ça.',
      niveau: 'leger',
    });
    assert.equal(resultat.ok, false);
    assert.equal(resultat.proposal, undefined, 'rien ne doit s’afficher dans la conversation');
    assert.match(resultat.text, /REFUS/i);
    assert.match(resultat.text, /reformul/i);
  });

  test(`${outil} : un titre seul est refusé`, async () => {
    const projet = projetDEssai();
    const resultat = await callTool({ projectId: projet.id, role: 'cadrage' } as any, outil, {
      title: 'Corriger le tableau',
      niveau: 'leger',
    });
    assert.equal(resultat.ok, false);
    assert.equal(resultat.proposal, undefined);
  });

  test(`${outil} : la carte COURTE du chef passe, la même carte d’un autre rôle non`, async () => {
    const projet = projetDEssai();
    const duChef = await callTool({ projectId: projet.id, role: 'cadrage' } as any, outil, {
      title: 'Stabiliser la colonne « À déployer »',
      description: CARTE_COURTE,
      contexte: SYNTHESE,
      niveau: 'standard',
    });
    assert.equal(duChef.ok, true, duChef.text);
    assert.equal(duChef.proposal?.description, CARTE_COURTE);

    // Un agent d'un autre rôle a, lui, vraiment étudié : il garde les quatre parties.
    const dUnAutre = await callTool({ projectId: projet.id, role: 'analysis' } as any, outil, {
      title: 'Stabiliser la colonne « À déployer »',
      description: CARTE_COURTE,
      contexte: SYNTHESE,
    });
    assert.equal(dUnAutre.ok, false);
    assert.match(dUnAutre.text, /Constat/);
  });

  test(`${outil} : une vraie description est acceptée`, async () => {
    const projet = projetDEssai();
    const resultat = await callTool({ projectId: projet.id } as any, outil, {
      title: 'Corriger le clignotement de la colonne',
      description: BONNE_DESCRIPTION,
      contexte: SYNTHESE,
    });
    assert.equal(resultat.ok, true, resultat.text);
    assert.equal(resultat.proposal?.description, BONNE_DESCRIPTION);
  });

  test(`${outil} : les quatre champs séparés suffisent`, async () => {
    const projet = projetDEssai();
    const resultat = await callTool({ projectId: projet.id } as any, outil, {
      title: 'Corriger le clignotement de la colonne',
      contexte: SYNTHESE,
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
    assert.match(String(champs.description?.description ?? ''), /REFORMUL/i);
    for (const partie of ['constat', 'attendu', 'limites', 'verification']) {
      assert.ok(partie in champs, `le champ « ${partie} » manque à ${outil}`);
    }
  });
}

/* ------------------------------------------------------------------ */
/* La même exigence sous les deux moteurs                               */
/* ------------------------------------------------------------------ */

test('le chef reçoit la MÊME consigne de carte courte, quel que soit le moteur', () => {
  for (const isSelf of [false, true]) {
    const claude = rolePrompt('cadrage', isSelf, 'claude');
    const codex = rolePrompt('cadrage', isSelf, 'codex');
    assert.ok(claude.includes(CONSIGNE_CARTE_COURTE), 'consigne absente du briefing Claude');
    assert.ok(codex.includes(CONSIGNE_CARTE_COURTE), 'consigne absente du briefing Codex');
    // Il ne reçoit PLUS l'exigence en quatre parties : il n'ouvre pas le projet.
    assert.ok(!claude.includes(CONSIGNE_DESCRIPTION_CARTE), 'le chef ne doit plus porter les quatre parties');
  }
});

test('la consigne de carte courte dit de ne rien inventer sur le code', () => {
  assert.match(CONSIGNE_CARTE_COURTE, /REFORMULE la demande/);
  assert.match(CONSIGNE_CARTE_COURTE, /N'OUVRES PAS LE PROJET/);
});

test('aucune des deux consignes ne nomme un outil propre à un moteur', () => {
  for (const consigne of [CONSIGNE_DESCRIPTION_CARTE, CONSIGNE_CARTE_COURTE]) {
    assert.doesNotMatch(consigne, /TaskCreate|TaskUpdate|update_plan|TodoWrite/);
  }
});

/* ------------------------------------------------------------------ */
/* La règle pure : deux exigences, un seul juge                         */
/* ------------------------------------------------------------------ */

test('une carte courte passe en exigence « courte », jamais en « complete »', () => {
  assert.equal(jugerDescription(CARTE_COURTE, 'courte').ok, true);
  const complete = jugerDescription(CARTE_COURTE, 'complete');
  assert.equal(complete.ok, false);
  assert.ok(complete.manques.includes('constat'));
});

test('une carte courte trop maigre est refusée, même en exigence « courte »', () => {
  const verdict = jugerDescription('Corrige ça.', 'courte');
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.manques, ['trop-courte']);
  assert.ok(verdict.signes < MIN_SIGNES_CARTE_COURTE);
});

test('une description complète reste acceptée en exigence « courte »', () => {
  assert.equal(jugerDescription(BONNE_DESCRIPTION, 'courte').ok, true);
});

/* ------------------------------------------------------------------ */
/* Une carte qui RENVOIE au fil ne dit pas son sujet                    */
/* ------------------------------------------------------------------ */

/*
 * Le chef a la conversation sous les yeux ; l'agent qui exécutera la carte ne
 * l'a pas. Une carte qui dit « corriger ce qui a été discuté » part donc vers
 * quelqu'un pour qui ces mots ne désignent rien. Le refus vit dans la règle
 * pure, pour valoir sous les deux moteurs.
 */

const RENVOIS_REFUSES = [
  "Corriger ce qui a été discuté juste avant dans la conversation, en gardant le reste de l'écran intact.",
  "Reprendre ce dont on a parlé et l'appliquer à la colonne du tableau, sans toucher au reste.",
  'Mettre en place le point évoqué plus haut, tel que le chef vient de le reformuler pour cette carte.',
  "Comme convenu ci-dessus, renommer le bouton du bandeau du haut et vérifier qu'il reste lisible.",
  "Voir la conversation pour le détail de ce qu'il faut changer sur l'écran des réglages du projet.",
  "Faire ce qu'on vient de dire sur la barre d'écriture, sans rien changer d'autre dans l'interface.",
];

for (const texte of RENVOIS_REFUSES) {
  test(`une carte qui renvoie au fil est refusée : « ${texte.slice(0, 40)}… »`, () => {
    assert.equal(renvoieAuFil(texte), true);
    const verdict = jugerDescription(texte, 'courte');
    assert.equal(verdict.ok, false);
    assert.ok(verdict.manques.includes('renvoi-au-fil'));
    assert.match(verdict.message, /RENVOIE à la conversation/);
  });
}

const RENVOIS_ACCEPTES = [
  CARTE_COURTE,
  BONNE_DESCRIPTION,
  "Constat : le bouton « Publier » ne réagit plus, comme prévu depuis le passage à la nouvelle barre du haut de l'écran.",
  "Vérification : ouvrir la conversation de la carte et regarder la réponse s'afficher jusqu'au bout.",
];

for (const texte of RENVOIS_ACCEPTES) {
  test(`une carte qui NOMME son sujet passe : « ${texte.slice(0, 40)}… »`, () => {
    assert.equal(renvoieAuFil(texte), false);
    assert.ok(!jugerDescription(texte, 'courte').manques.includes('renvoi-au-fil'));
  });
}

test('le refus vaut aussi pour une description complète, quatre parties comprises', () => {
  const complete = [
    "Constat : le tableau se fabrique dans `web/src/components/board.tsx`, et le défaut est celui dont on a parlé.",
    'Attendu : le comportement décrit devient celui de la colonne.',
    'Limites : on ne touche à rien d’autre.',
    'Vérification : rejouer `npm test`.',
  ].join('\n');
  const verdict = jugerDescription(complete, 'complete');
  assert.equal(verdict.ok, false);
  assert.ok(verdict.manques.includes('renvoi-au-fil'));
});

test('la consigne du chef lui dit d’aller chercher le sujet dans le fil', () => {
  assert.match(CONSIGNE_CARTE_COURTE, /SE LIT SANS TA CONVERSATION/);
  assert.match(CONSIGNE_CARTE_COURTE, /REMONTE LE FIL/);
  assert.match(CONSIGNE_CARTE_COURTE, /NOMME-LE en toutes lettres/);
});
