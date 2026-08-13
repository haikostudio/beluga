import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ATTENTE_INITIALE_MS,
  ATTENTE_MAX_MS,
  ESSAIS_MAX,
  attenteAvantNouvelEssai,
  causeEnClair,
  demandeDeRepriseApresPanne,
  ligneDePanne,
  messageDePanneDefinitive,
  motifDePannePassagere,
} from '@haikodev/shared';
import { lancerAvecRelances } from '../relance-moteur.js';

/* ------------------------------------------------------------------ */
/* 1. RECONNAÎTRE la panne — et ne pas la voir là où elle n'est pas.    */
/* ------------------------------------------------------------------ */

test('les bannières vues sur de vraies tâches sont reconnues', () => {
  const cas: [string, string][] = [
    [
      'API Error: 500 Internal server error. This is a server-side issue, usually temporary — try again in a moment.',
      'erreur-serveur',
    ],
    ['API Error: Server error mid-response. The response above may be incomplete.', 'erreur-serveur'],
    ['API Error: 529 overloaded_error', 'erreur-serveur'],
    ['Error: socket hang up', 'lien-coupe'],
    ['503 Service Unavailable', 'erreur-serveur'],
  ];
  for (const [ligne, motif] of cas) {
    assert.equal(
      motifDePannePassagere({ ok: false, texte: ligne }),
      motif,
      `« ${ligne.slice(0, 40)}… » devrait être reconnue`,
    );
  }
});

test('un tour réussi, un arrêt demandé et une limite de quota ne sont jamais des pannes', () => {
  const bannier = 'API Error: 500 Internal server error.';
  assert.equal(motifDePannePassagere({ ok: true, texte: bannier }), null);
  assert.equal(motifDePannePassagere({ ok: false, arretDemande: true, texte: bannier }), null);
  assert.equal(motifDePannePassagere({ ok: false, limiteQuota: true, texte: bannier }), null);
});

test('une demande refusée n’est pas une panne passagère : la retenter répéterait le refus', () => {
  assert.equal(motifDePannePassagere({ ok: false, erreur: 'API Error: 401 Unauthorized' }), null);
  assert.equal(motifDePannePassagere({ ok: false, erreur: 'API Error: 400 invalid request' }), null);
});

test('un agent qui PARLE des erreurs 500 n’en déclenche pas une', () => {
  assert.equal(ligneDePanne('Le contrôle simule une « API Error: 500 Internal server error ».'), null);
  assert.equal(ligneDePanne('J’ai corrigé le cas `500 Internal server error` dans le démon.'), null);
  // Une phrase entière, où la tournure arrive bien après le début de la ligne.
  assert.equal(
    ligneDePanne(
      'Après avoir relu le démon, les moteurs et les règles partagées, j’ai constaté que la mention internal server error manquait.',
    ),
    null,
  );
});

test('la panne n’est cherchée que dans les DERNIÈRES lignes du texte', () => {
  const texte = ['API Error: 500 Internal server error', 'Je reprends le travail.', 'Terminé.', 'Voilà.'].join('\n');
  assert.equal(motifDePannePassagere({ ok: false, texte }), null, 'la bannière est trop haut dans le fil');
});

/* ------------------------------------------------------------------ */
/* 2. LE NOMBRE D'ESSAIS et l'attente croissante.                       */
/* ------------------------------------------------------------------ */

test('l’attente croît, et reste bornée', () => {
  assert.equal(attenteAvantNouvelEssai(1), ATTENTE_INITIALE_MS);
  assert.ok(attenteAvantNouvelEssai(2) > attenteAvantNouvelEssai(1));
  assert.ok(attenteAvantNouvelEssai(3) > attenteAvantNouvelEssai(2));
  assert.ok(attenteAvantNouvelEssai(12) <= ATTENTE_MAX_MS);
});

/* ------------------------------------------------------------------ */
/* 3. LA BOUCLE : retenter, aboutir, et ne rougir qu’au bout.           */
/* ------------------------------------------------------------------ */

/** Un moteur d'essai : il tombe `pannes` fois sur une 500, puis répond. */
function moteurQuiTombe(pannes: number) {
  const etat = { erreur: undefined as string | undefined, texte: '', appels: 0, prompts: [] as string[] };
  const lancer = (essai: number) => {
    etat.appels += 1;
    const tombe = etat.appels <= pannes;
    if (tombe) {
      etat.texte += `${etat.texte ? '\n' : ''}API Error: 500 Internal server error.`;
      etat.erreur = "Le moteur s'est arrêté (code 1).";
    } else {
      etat.texte += `${etat.texte ? '\n' : ''}Travail terminé au bout de ${essai} reprise(s).`;
      etat.erreur = undefined;
    }
    return { finished: Promise.resolve({ ok: !tombe, error: tombe ? etat.erreur : undefined }) };
  };
  return { etat, lancer };
}

test('un tour coupé par une 500 retente et aboutit, sans erreur rouge', async () => {
  const moteur = moteurQuiTombe(2);
  const attentes: number[] = [];
  const relance = await lancerAvecRelances({
    lancer: (essai, motif) => {
      if (essai > 0) moteur.etat.prompts.push(demandeDeRepriseApresPanne(motif!, essai));
      return moteur.lancer(essai);
    },
    etat: () => ({ erreur: moteur.etat.erreur, texte: moteur.etat.texte }),
    attendre: async (ms) => {
      attentes.push(ms);
    },
  });

  assert.equal(relance.essais, 2, 'deux nouveaux essais');
  assert.equal(relance.panne, null, 'plus aucune panne : le tour a abouti');
  assert.equal(relance.result.ok, true);
  assert.deepEqual(attentes, [attenteAvantNouvelEssai(1), attenteAvantNouvelEssai(2)], 'attente croissante');
  assert.match(moteur.etat.prompts[0], /CONTINUE EXACTEMENT OÙ TU T'ES ARRÊTÉ/);
  assert.doesNotMatch(moteur.etat.prompts[0], /repars de zéro(?! )/);
});

test('une panne qui dure rend la main après un nombre borné d’essais, cause en clair', async () => {
  const moteur = moteurQuiTombe(50);
  const relance = await lancerAvecRelances({
    lancer: (essai) => moteur.lancer(essai),
    etat: () => ({ erreur: moteur.etat.erreur, texte: moteur.etat.texte }),
    attendre: async () => {},
  });

  assert.equal(relance.essais, ESSAIS_MAX, 'le nombre d’essais est borné');
  assert.equal(moteur.etat.appels, ESSAIS_MAX + 1, 'le premier départ, puis les essais');
  assert.equal(relance.panne, 'erreur-serveur');
  const message = messageDePanneDefinitive(relance.panne!, relance.essais);
  assert.match(message, /interrompu/i, 'la tâche est dite interrompue');
  assert.match(message, /erreur 500/, 'la cause réelle est nommée');
  assert.doesNotMatch(message, /code 1/, 'jamais un code de sortie brut');
  assert.match(causeEnClair('erreur-serveur'), /fournisseur/);
});

test('un échec ordinaire ne déclenche aucun nouvel essai', async () => {
  let appels = 0;
  const relance = await lancerAvecRelances({
    lancer: () => {
      appels += 1;
      return { finished: Promise.resolve({ ok: false, error: 'API Error: 400 invalid request' }) };
    },
    etat: () => ({ erreur: 'API Error: 400 invalid request', texte: '' }),
    attendre: async () => {},
  });
  assert.equal(appels, 1);
  assert.equal(relance.essais, 0);
  assert.equal(relance.panne, null, 'un échec ordinaire reste un échec ordinaire');
});

test('un arrêt demandé pendant l’attente ferme la porte', async () => {
  let arret = false;
  let appels = 0;
  const relance = await lancerAvecRelances({
    lancer: () => {
      appels += 1;
      return { finished: Promise.resolve({ ok: false, error: 'API Error: 500 Internal server error' }) };
    },
    etat: () => ({ erreur: 'API Error: 500 Internal server error', texte: '', arretDemande: arret }),
    attendre: async () => {
      arret = true;
    },
  });
  assert.equal(appels, 1, 'le moteur n’est pas relancé après un arrêt à la main');
  assert.ok(relance.panne, 'la cause reste dite');
});

/* ------------------------------------------------------------------ */
/* 4. LE BRANCHEMENT dans le démon, là où il compte.                    */
/* ------------------------------------------------------------------ */

test('le tour du démon passe par la relance, et n’affiche la panne qu’au bout', () => {
  const runtime = fs.readFileSync(new URL('../../src/runtime.ts', import.meta.url), 'utf8');
  assert.match(runtime, /await lancerAvecRelances\(/, 'le tour passe par la boucle de relance');
  assert.match(
    runtime,
    /panneDefinitive\s*\n?\s*\?\s*messageDePanneDefinitive/,
    'le rouge ne s’affiche qu’après tous les essais, avec la cause réelle',
  );
  assert.match(
    runtime,
    /reprise \|\| panneDefinitive \? 'stopped'/,
    'une tâche interrompue par le fournisseur n’est pas marquée en échec',
  );
  assert.match(runtime, /usageDesEssaisPrecedents = runState\.usage/, 'les essais s’additionnent dans la mesure');
});
