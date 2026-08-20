import test from 'node:test';
import assert from 'node:assert/strict';

/* ------------------------------------------------------------------ */
/* LE FICHIER D'INSTRUCTIONS NE BOUGE PLUS EN PLEINE JOURNÉE.          */
/*                                                                     */
/* Mesuré le 17/08/2026 : `CLAUDE.md` pèse 73 423 jetons, il est relu  */
/* à chacun des 62 allers-retours d'un tour de carte, et il était      */
/* réécrit 30 à 60 fois par jour — chaque réécriture faisant repayer   */
/* ces jetons au plein tarif aux agents qui démarrent ensuite.         */
/* ------------------------------------------------------------------ */

const {
  FENETRE_DE_FUSION,
  PERIODE_DE_FUSION_MS,
  SUJETS_REGLES,
  decisionDeFusion,
  entreeEnMarkdown,
  fichierApresFusion,
  lireEntrees,
  planDeFusion,
  PLAFOND_INSTRUCTIONS_SIGNES,
  compacterInstructions,
  contratMisDeCote,
  contratsQuiTiennent,
  ditLaMemeChose,
  ligneDeContrat,
} = await import('@haikodev/shared');

const SUJETS = SUJETS_REGLES.map((s: { id: string }) => s.id);

const UNE_ENTREE = `# Instructions en attente

Le mode d'emploi, qui n'est jamais une entrée.

## Une règle apprise
- sujet : cartes
- contrat : une carte close ne rouvre jamais toute seule

Le texte entier de la règle, avec le fichier qui la porte.
`;

test("le mode d'emploi n'est pas lu comme une entrée", () => {
  const entrees = lireEntrees(UNE_ENTREE);
  assert.equal(entrees.length, 1);
  assert.equal(entrees[0].titre, 'Une règle apprise');
  assert.equal(entrees[0].sujet, 'cartes');
  assert.match(entrees[0].texte, /texte entier de la règle/);
});

test('un aller-retour par le markdown ne perd rien', () => {
  const entree = { titre: 'Titre', sujet: 'quotas', contrat: 'la ligne courte', texte: 'Le texte.' };
  const relu = lireEntrees(`# entête\n\n${entreeEnMarkdown(entree)}`);
  assert.deepEqual(relu, [entree]);
});

test('le texte va dans le sujet, et seule la ligne de contrat monte au contrat', () => {
  const plan = planDeFusion(lireEntrees(UNE_ENTREE), SUJETS);
  assert.equal(plan.parSujet.length, 1);
  assert.equal(plan.parSujet[0].sujet, 'cartes');
  assert.match(plan.parSujet[0].texte, /texte entier de la règle/);
  assert.equal(plan.contrat.length, 1);
  assert.equal(plan.contrat[0].sujet, 'cartes');
  assert.match(plan.contrat[0].ligne, /ne rouvre jamais toute seule/);
  // Le texte entier ne doit JAMAIS monter dans le contrat : c'est tout l'objet.
  assert.doesNotMatch(plan.contrat[0].ligne, /texte entier de la règle/);
});

test('une entrée sans ligne de contrat ne fait pas grossir le fichier d’instructions', () => {
  const plan = planDeFusion(lireEntrees('## Sans contrat\n- sujet : voix\n\nUn texte.\n'), SUJETS);
  assert.equal(plan.parSujet.length, 1);
  assert.equal(plan.contrat.length, 0);
});

test('un sujet inconnu part au repli, en disant d’où il vient — plus jamais bloqué pour toujours', () => {
  const plan = planDeFusion(lireEntrees('## Perdue\n- sujet : cuisine\n\nUn texte.\n'), SUJETS);
  assert.equal(plan.refusees.length, 0);
  assert.equal(plan.parSujet.length, 1);
  assert.equal(plan.parSujet[0].sujet, 'methode');
  assert.match(plan.parSujet[0].texte, /Un texte\./);
  // Le déplacement se DIT : une règle de cuisine rangée dans « methode » ne
  // doit pas passer pour une règle de méthode.
  assert.match(plan.parSujet[0].texte, /« cuisine », qui n'existe pas/);
  assert.match(plan.parSujet[0].texte, /à déplacer/);
});

test('une entrée sans sujet part au repli aussi, et une entrée VIDE reste refusée', () => {
  const sansSujet = planDeFusion(lireEntrees('## Muette\n\nUn texte.\n'), SUJETS);
  assert.equal(sansSujet.refusees.length, 0);
  assert.equal(sansSujet.parSujet[0].sujet, 'methode');
  assert.match(sansSujet.parSujet[0].texte, /déposée sans sujet/);

  // Rien à ranger : là, le refus reste la seule réponse honnête.
  const sansTexte = planDeFusion(lireEntrees('## Vide\n- sujet : cartes\n'), SUJETS);
  assert.match(sansTexte.refusees[0].raison, /sans texte/);
});

test('sans sujet de repli sur le projet, le refus d’avant tient toujours', () => {
  const plan = planDeFusion(lireEntrees('## Perdue\n- sujet : cuisine\n\nUn texte.\n'), ['cartes']);
  assert.equal(plan.parSujet.length, 0);
  assert.match(plan.refusees[0].raison, /sujet inconnu/);

  const reste = fichierApresFusion(plan.refusees);
  assert.match(reste, /## Perdue/);
  assert.match(reste, /Non rangée cette nuit/);
  assert.equal(lireEntrees(reste).length, 1);
});

test('les avertissements ne s’empilent pas d’une nuit à l’autre', () => {
  // Trois nuits de suite sur un projet qui n'a pas le sujet demandé : le
  // fichier d'attente doit rendre le MÊME texte, sans un avertissement de plus.
  let fichier = '## Perdue\n- sujet : cuisine\n\nUn texte.\n';
  const tailles: number[] = [];
  for (let nuit = 0; nuit < 3; nuit++) {
    const plan = planDeFusion(lireEntrees(fichier), ['cartes']);
    fichier = fichierApresFusion(plan.refusees);
    tailles.push(fichier.length);
  }
  assert.equal(tailles[0], tailles[1]);
  assert.equal(tailles[1], tailles[2]);
  assert.equal((fichier.match(/Non rangée cette nuit/g) ?? []).length, 1);
  assert.equal(lireEntrees(fichier)[0].texte, 'Un texte.');
});

/* ------------------------------------------------------------------ */
/* LE PLAFOND, TENU PAR LE RANGEMENT LUI-MÊME                          */
/* ------------------------------------------------------------------ */

test('un contrat qui redit son titre ne s’écrit qu’une fois', () => {
  assert.equal(
    ligneDeContrat('Le menu du bas emprunte le fond', 'LE MENU DU BAS EMPRUNTE LE FOND DE LA ZONE'),
    '- **Le menu du bas emprunte le fond**',
  );
  assert.equal(ligneDeContrat('Un titre', ''), '- **Un titre**');
  // Deux idées différentes gardent bien leurs deux moitiés.
  assert.match(ligneDeContrat('Un titre court', 'UNE RÈGLE ENTIÈREMENT AUTRE SUR LES BRANCHES'), / — UNE RÈGLE/);
  assert.equal(ditLaMemeChose('les cartes closes', 'LES CARTES CLOSES'), true);
  assert.equal(ditLaMemeChose('les cartes closes', 'la publication du soir'), false);
});

test('compacter le fichier d’instructions ne perd aucun invariant', () => {
  const avant = [
    '# Titre',
    '- **Une règle** — UNE RÈGLE',
    '- **Une règle** — UNE RÈGLE',
    '- **Une autre** — UN PROPOS COMPLÈTEMENT DIFFÉRENT SUR LA PUBLICATION',
    'Du texte ordinaire, laissé tel quel.',
  ].join('\n');
  const apres = compacterInstructions(avant);
  assert.equal(apres.doublons, 1);
  assert.equal(apres.compactees, 1);
  assert.ok(apres.gagnes > 0);
  assert.match(apres.texte, /- \*\*Une règle\*\*$/m);
  assert.match(apres.texte, /UN PROPOS COMPLÈTEMENT DIFFÉRENT/);
  assert.match(apres.texte, /Du texte ordinaire, laissé tel quel\./);
  // Chaque NOM d'invariant survit : c'est la seule chose qu'on ne touche pas.
  assert.match(apres.texte, /Une autre/);
});

test('le rangement n’ajoute que les lignes qui tiennent sous le plafond', () => {
  const lignes = [
    { ligne: '- **A**'.padEnd(50, '.'), titre: 'A' },
    { ligne: '- **B**'.padEnd(50, '.'), titre: 'B' },
    { ligne: '- **C**'.padEnd(50, '.'), titre: 'C' },
  ];
  const tri = contratsQuiTiennent(0, lignes, 110);
  assert.deepEqual(tri.retenues.map((c) => c.titre), ['A', 'B']);
  assert.deepEqual(tri.debordent.map((c) => c.titre), ['C']);

  // Un fichier déjà plein n'accepte plus rien, et rien n'est tronqué.
  const plein = contratsQuiTiennent(PLAFOND_INSTRUCTIONS_SIGNES, lignes);
  assert.equal(plein.retenues.length, 0);
  assert.equal(plein.debordent.length, 3);
});

test('un invariant que le plafond écarte est DIT dans le fichier de son sujet', () => {
  const note = contratMisDeCote({ titre: 'Une règle tardive', ligne: '- **Une règle tardive**' });
  assert.match(note, /« Une règle tardive »/);
  assert.match(note, /n'est PAS nommée dans le fichier d'instructions/);
  assert.match(note, /project_memory/);
});

test('rien en attente : le fichier d’instructions ne bouge pas', () => {
  const decision = decisionDeFusion({ maintenant: new Date(2026, 7, 18, 3), entreesEnAttente: 0 });
  assert.equal(decision.fusionner, false);
  assert.match(decision.raison, /rien en attente/);
});

test('le rangement attend la nuit', () => {
  const jour = decisionDeFusion({ maintenant: new Date(2026, 7, 18, 14), entreesEnAttente: 2 });
  assert.equal(jour.fusionner, false);
  assert.match(jour.raison, /fenêtre/);

  const nuit = decisionDeFusion({ maintenant: new Date(2026, 7, 18, FENETRE_DE_FUSION.debut), entreesEnAttente: 2 });
  assert.equal(nuit.fusionner, true);
});

test('une seule fois par nuit', () => {
  const maintenant = new Date(2026, 7, 18, 3);
  const dejaFait = decisionDeFusion({
    maintenant,
    derniereFusionA: maintenant.getTime() - 60_000,
    entreesEnAttente: 2,
  });
  assert.equal(dejaFait.fusionner, false);
  assert.match(dejaFait.raison, /déjà rangé/);

  const nuitSuivante = decisionDeFusion({
    maintenant,
    derniereFusionA: maintenant.getTime() - PERIODE_DE_FUSION_MS - 1,
    entreesEnAttente: 2,
  });
  assert.equal(nuitSuivante.fusionner, true);
});
