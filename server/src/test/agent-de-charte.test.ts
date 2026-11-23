import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PREMIER_MESSAGE_CHARTE_EXISTANTE,
  PREMIER_MESSAGE_CHARTE_NEUVE,
  adresseDeLAgentDeCharte,
  blocsDUneCharteNeuve,
  consigneDeLAgentDeCharte,
  estUnMessageDuDemonDeCharte,
  etapesFaitesDeLaCharte,
  lireLesBlocs,
  parcoursDeLaCharte,
  plaquetteDeLAgentDeCharte,
  serviceDeLAgentDeCharte,
  type BlocDePlaquette,
} from '@beluga/shared';

const id = (() => {
  let n = 0;
  return () => `b${++n}`;
})();

test('charte : l’adresse de l’agent est celle de l’écran du document, et se relit', () => {
  const s = serviceDeLAgentDeCharte('p1', 'd1');
  assert.equal(s.adresse, adresseDeLAgentDeCharte('p1', 'd1'));
  assert.equal(s.adresse, 'charte/p1/d1');
  assert.deepEqual(plaquetteDeLAgentDeCharte(s), { projectId: 'p1', plaquetteId: 'd1' });
  /* Un agent créé avant le renommage (ancien mot « plaquettes ») est toujours reconnu. */
  assert.deepEqual(plaquetteDeLAgentDeCharte({ id: 'charte', adresse: 'plaquettes/p1/d1' }), { projectId: 'p1', plaquetteId: 'd1' });
  /* Un autre service à la même forme d'adresse, ou un agent sans service, n'est pas un agent de charte. */
  assert.equal(plaquetteDeLAgentDeCharte({ id: 'strategie', adresse: 'plaquettes/p1/d1' }), null);
  assert.equal(plaquetteDeLAgentDeCharte(undefined), null);
  assert.equal(plaquetteDeLAgentDeCharte({ id: 'charte', adresse: 'plaquettes/p1' }), null);
});

test('charte : les messages du démon ne sont pas des bulles de l’utilisateur', () => {
  assert.ok(estUnMessageDuDemonDeCharte(PREMIER_MESSAGE_CHARTE_NEUVE));
  assert.ok(estUnMessageDuDemonDeCharte(` ${PREMIER_MESSAGE_CHARTE_EXISTANTE} `));
  assert.ok(!estUnMessageDuDemonDeCharte('Commençons la charte graphique de ce projet, en bleu.'));
});

test('charte : une charte neuve passe la lecture stricte des blocs, et commence à la Marque', () => {
  const lus = lireLesBlocs(blocsDUneCharteNeuve('Toogo'), id);
  assert.ok(lus.ok);
  const parcours = parcoursDeLaCharte(lus.ok ? lus.blocs : []);
  assert.equal(parcours.length, 7);
  assert.deepEqual(parcours.map((e) => e.etat), ['ici', 'a_faire', 'a_faire', 'a_faire', 'a_faire', 'a_faire', 'a_faire']);
  assert.deepEqual(parcours.map((e) => e.libelle), ['Marque', 'Logo', 'Couleurs', 'Typographies', 'Composants', 'Ton et voix', 'Présentation']);
});

test('charte : les étapes faites se lisent dans le document lui-même', () => {
  const blocs: BlocDePlaquette[] = [
    { id: 'c', genre: 'couverture', titre: 'Toogo', texte: 'La promesse de la marque.' },
    { id: 's', genre: 'sommaire' },
    { id: 'p', genre: 'partie', titre: 'Charte graphique' },
    { id: 'l', genre: 'logo', titre: 'Logo', pieces: ['att-1'] },
    { id: 'k', genre: 'couleurs', titre: 'Couleurs', elements: [{ valeur: '#112233', libelle: 'Bleu — principal' }] },
    { id: 'y', genre: 'typographies', titre: 'Typographies', elements: [] },
    { id: 'b', genre: 'galerie', titre: 'Composants', pieces: ['att-2'] },
    { id: 't', genre: 'texte', titre: 'Ton et voix', texte: 'Direct, chaleureux.' },
    { id: 'm', genre: 'partie', titre: 'Cartes de visite et papier à lettres', masque: true },
    { id: 'n', genre: 'texte', titre: 'Cartes de visite', texte: 'À compléter', masque: true },
  ];
  const faites = etapesFaitesDeLaCharte(blocs);
  assert.deepEqual([...faites].sort(), ['composants', 'couleurs', 'logo', 'marque', 'ton']);
  /* Les typographies sans élément ne comptent pas : c'est l'étape en cours, même si la suivante est faite. */
  const parcours = parcoursDeLaCharte(blocs);
  assert.equal(parcours.find((e) => e.etat === 'ici')?.cle, 'typographies');
  assert.equal(parcours.find((e) => e.cle === 'composants')?.etat, 'fait');
  /* Une partie de présentation avec du contenu fait la dernière étape. */
  const avecPresentation = [...blocs, { id: 'q', genre: 'partie' as const, titre: 'Présentation du produit' }, { id: 'r', genre: 'texte' as const, texte: 'Une application de covoiturage.' }];
  assert.ok(etapesFaitesDeLaCharte(avecPresentation).has('presentation'));
  /* Une partie de supports masquée ne passe pas pour une présentation. */
  assert.ok(!etapesFaitesDeLaCharte(blocs).has('presentation'));
});

test('charte : la consigne vise CE document, interdit d’en créer un autre et garde les règles de la marque', () => {
  const c = consigneDeLAgentDeCharte({
    plaquette: {
      id: 'doc-42',
      titre: 'Charte graphique — Toogo',
      format: 'a4-portrait',
      adresse: 'vous',
      version: 3,
      marque: { nom: 'Toogo', couleur: '#2b2b2b', texte: '#1f2328', fond: '#ffffff' },
      blocs: [{ id: 'c', genre: 'couverture', titre: 'Toogo' }],
    },
    projet: { nom: 'Toogo', dossier: '/root/toogo', site: 'https://toogo.example' },
    commentairesOuverts: 2,
  });
  assert.match(c, /plaquette = doc-42/);
  assert.match(c, /plaquette_modifier/);
  assert.match(c, /JAMAIS « plaquette_creer »/);
  assert.match(c, /releve_de_charte/);
  assert.match(c, /jamais celle du studio/);
  assert.match(c, /UNE QUESTION À LA FOIS/);
  assert.match(c, /ITÉRATION EST LIBRE/);
  assert.match(c, /Étape en cours : Marque\./);
  assert.match(c, /AUCUN logo encore/);
  assert.match(c, /2 commentaire\(s\) du client/);
  assert.match(c, /https:\/\/toogo\.example/);
});
