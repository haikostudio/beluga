import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* LE DÉMON APPELLE L'OUTIL À LA PLACE DU MODÈLE                        */
/* ------------------------------------------------------------------ */

/*
 * Le filet de dernier recours du rattrapage : quand le chef ÉCRIT sa carte au
 * lieu de l'appeler — et qu'il recommence après relance —, HaikoDev relit ce
 * texte (`carteDecriteEnTexte`) et appelle `board_create_card` LUI-MÊME.
 *
 * Ce contrôle rejoue le chemin entier sur une VRAIE base jetable : le texte
 * brut d'un modèle en entrée, une proposition affichable en sortie. Il vérifie
 * aussi les deux refus qui vont avec : rien n'entre sur le tableau sans le clic
 * de l'utilisateur, et une carte qui n'est pas décrite n'est pas inventée.
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'carte-relue-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');
const { callTool } = await import('../tools.js');
const { carteDecriteEnTexte, syntheseDeSecours } = await import('@haikodev/shared');

/** Le texte tel qu'un modèle l'a réellement rendu, sans appeler l'outil. */
const TEXTE_DU_CHEF = `Parfait ! Je vois les 5 images des formations.

## **Carte proposée**

**Intégrer les images des formations dans la vitrine avec fonds transparents**

À faire : importer les 5 images dans le projet, retirer les fonds blancs, puis les brancher sur la vitrine (probablement la page d'accueil du catalogue). Test visuel : vérifier que chaque formation s'affiche avec sa vignette claire et sans débordements.

**Niveau :** Standard`;

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

test('la carte écrite en texte devient une VRAIE proposition, sans le modèle', async () => {
  const projet = projetDEssai();
  const relue = carteDecriteEnTexte(TEXTE_DU_CHEF);
  assert.ok(relue, 'le texte du chef doit se relire');

  const resultat = await callTool({ projectId: projet.id, role: 'orchestrator' } as any, 'board_create_card', {
    title: relue!.titre,
    description: relue!.description,
    niveau: relue!.niveau,
    // Ce que fait le démon dans `poserLaCarteRelue` : le chef n'a rédigé
    // aucune synthèse, sa réponse entière en tient lieu et n'est pas jugée.
    contexte: syntheseDeSecours(TEXTE_DU_CHEF),
    secours: true,
  });

  assert.equal(resultat.ok, true, resultat.text);
  assert.ok(resultat.proposal, 'une proposition doit naître de la carte relue');
  assert.equal(resultat.proposal!.title, 'Intégrer les images des formations dans la vitrine avec fonds transparents');
  assert.equal(resultat.proposal!.decision, 'pending', 'elle attend toujours le clic');
});

test('le tableau ne bouge pas : une proposition reste une proposition', async () => {
  const projet = projetDEssai();
  const avant = store.listCards(projet.id).length;
  const relue = carteDecriteEnTexte(TEXTE_DU_CHEF)!;

  await callTool({ projectId: projet.id, role: 'orchestrator' } as any, 'board_create_card', {
    title: relue.titre,
    description: relue.description,
    niveau: relue.niveau,
    contexte: syntheseDeSecours(TEXTE_DU_CHEF),
    secours: true,
  });

  assert.equal(store.listCards(projet.id).length, avant);
});

test('en MODE PLAN, le démon ne pose rien non plus', async () => {
  const projet = projetDEssai();
  const relue = carteDecriteEnTexte(TEXTE_DU_CHEF)!;

  const resultat = await callTool(
    { projectId: projet.id, role: 'orchestrator', mode: 'plan' } as any,
    'board_create_card',
    {
      title: relue.titre,
      description: relue.description,
      niveau: relue.niveau,
      contexte: syntheseDeSecours(TEXTE_DU_CHEF),
      secours: true,
    },
  );

  assert.equal(resultat.ok, false);
  assert.equal(resultat.proposal, undefined);
});

test('une description trop maigre reste refusée, d’où qu’elle vienne', async () => {
  const projet = projetDEssai();
  const resultat = await callTool({ projectId: projet.id, role: 'orchestrator' } as any, 'board_create_card', {
    title: 'Corriger ça',
    description: 'Voir la conversation.',
  });

  assert.equal(resultat.ok, false);
  assert.equal(resultat.proposal, undefined);
});
