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
  assert.match(plan.contrat[0], /ne rouvre jamais toute seule/);
  // Le texte entier ne doit JAMAIS monter dans le contrat : c'est tout l'objet.
  assert.doesNotMatch(plan.contrat[0], /texte entier de la règle/);
});

test('une entrée sans ligne de contrat ne fait pas grossir le fichier d’instructions', () => {
  const plan = planDeFusion(lireEntrees('## Sans contrat\n- sujet : voix\n\nUn texte.\n'), SUJETS);
  assert.equal(plan.parSujet.length, 1);
  assert.equal(plan.contrat.length, 0);
});

test('un sujet inconnu reste en attente, avec sa raison, et rien n’est jeté', () => {
  const plan = planDeFusion(lireEntrees('## Perdue\n- sujet : cuisine\n\nUn texte.\n'), SUJETS);
  assert.equal(plan.parSujet.length, 0);
  assert.equal(plan.refusees.length, 1);
  assert.match(plan.refusees[0].raison, /sujet inconnu/);

  const reste = fichierApresFusion(plan.refusees);
  assert.match(reste, /## Perdue/);
  assert.match(reste, /Un texte\./);
  assert.match(reste, /Non rangée cette nuit/);
  // Relu, il redonne bien l'entrée : elle repassera la nuit suivante.
  assert.equal(lireEntrees(reste).length, 1);
});

test('une entrée sans sujet ou sans texte est refusée, jamais rangée au hasard', () => {
  const sansSujet = planDeFusion(lireEntrees('## Muette\n\nUn texte.\n'), SUJETS);
  assert.match(sansSujet.refusees[0].raison, /aucun sujet/);
  const sansTexte = planDeFusion(lireEntrees('## Vide\n- sujet : cartes\n'), SUJETS);
  assert.match(sansTexte.refusees[0].raison, /sans texte/);
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
