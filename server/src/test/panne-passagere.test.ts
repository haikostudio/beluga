import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ATTENTE_INITIALE_MS,
  ATTENTE_MAX_MS,
  ESSAIS_MAX,
  attenteAvantNouvelEssai,
  causeEnClair,
  causeLaPlusParlante,
  diseLaCause,
  SEPARATEUR_DEMANDE,
  demandeDeRepriseApresPanne,
  ligneDePanne,
  messageDePanneDefinitive,
  motifDePannePassagere,
  panneDeLaMachine,
} from '@beluga/shared';
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

test('une session expirée côté fournisseur (« No conversation found ») est reconnue, et pas comme un refus définitif', () => {
  const cas = [
    'No conversation found with session ID: 3f1a2c4e-…',
    'Error: conversation not found',
    'session not found for the given id',
  ];
  for (const ligne of cas) {
    assert.equal(motifDePannePassagere({ ok: false, erreur: ligne }), 'session-morte', `« ${ligne} » devrait être reconnue`);
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

/** Le prompt du tour, tel que `preparerLeTour` l'assemble : c'est lui qui doit repartir. */
const PROMPT_DU_TOUR = 'Réalise cette tâche.\n\nTITRE : Ranger les tags fichier dans le texte';

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
      if (essai > 0)
        moteur.etat.prompts.push(
          demandeDeRepriseApresPanne({
            motif: motif!,
            essai,
            promptDuTour: PROMPT_DU_TOUR,
            travailCommence: true,
            filNeuf: false,
          }),
        );
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
  assert.ok(
    moteur.etat.prompts.every((envoi) => envoi.includes(PROMPT_DU_TOUR)),
    'chaque essai emporte la demande de son tour',
  );
});

/* ------------------------------------------------------------------ */
/* 4. LA DEMANDE DU TOUR REPART À CHAQUE ESSAI.                         */
/* ------------------------------------------------------------------ */

test('un nouvel essai recopie la demande de SON tour, et interdit de reprendre une plus ancienne', () => {
  const envoi = demandeDeRepriseApresPanne({
    motif: 'erreur-serveur',
    essai: 1,
    promptDuTour: PROMPT_DU_TOUR,
    travailCommence: true,
    filNeuf: false,
  });
  assert.ok(envoi.includes(SEPARATEUR_DEMANDE), 'la demande est annoncée par son intitulé');
  assert.ok(envoi.includes(PROMPT_DU_TOUR), 'la demande du tour est recopiée en entier');
  assert.match(envoi, /ET AUCUNE AUTRE/, 'la consigne interdit de reprendre une demande plus ancienne');
  assert.ok(
    envoi.indexOf(SEPARATEUR_DEMANDE) < envoi.indexOf(PROMPT_DU_TOUR),
    'la demande vient APRÈS son intitulé, jamais mêlée à l’en-tête',
  );
});

test('un fil NEUF (session expirée) reçoit tout, et ne s’entend pas dire de continuer un travail qu’il ne connaît plus', () => {
  const envoi = demandeDeRepriseApresPanne({
    motif: 'session-morte',
    essai: 1,
    promptDuTour: PROMPT_DU_TOUR,
    travailCommence: true,
    filNeuf: true,
  });
  assert.ok(envoi.includes(PROMPT_DU_TOUR), 'la demande repart en entier sur un fil vide');
  assert.match(envoi, /TON FIL PRÉCÉDENT N'EXISTE PLUS/);
  assert.doesNotMatch(envoi, /CONTINUE EXACTEMENT OÙ TU T'ES ARRÊTÉ/, 'rien à continuer : il ne se souvient de rien');
});

test('un moteur tombé AVANT d’avoir rien fait s’entend dire que tout est à faire', () => {
  const envoi = demandeDeRepriseApresPanne({
    motif: 'lien-coupe',
    essai: 2,
    promptDuTour: PROMPT_DU_TOUR,
    travailCommence: false,
    filNeuf: false,
  });
  assert.match(envoi, /TU ES TOMBÉ AVANT D'AVOIR TRAITÉ LA DEMANDE/);
  assert.doesNotMatch(envoi, /reprends ta liste de tâches/);
  assert.ok(envoi.includes(PROMPT_DU_TOUR));
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
  assert.match(
    runtime,
    /motif === 'session-morte'[\s\S]{0,400}store\.clearSession\(agent\.id, cleSession\)/,
    'une session morte est oubliée avant le nouvel essai, pour repartir sur un fil neuf',
  );
});

/* ------------------------------------------------------------------ */
/* LE CAS « INTÉGRATION GPT EN PANNE » — saturation du modèle Codex.    */
/* ------------------------------------------------------------------ */

test('« Selected model is at capacity » est une panne passagère, pas un échec de la tâche', () => {
  const cas = [
    'Selected model is at capacity. Please try a different model.',
    'Error: selected model is at capacity',
    'The engine is at capacity, please try a different model later.',
  ];
  for (const ligne of cas) {
    assert.equal(motifDePannePassagere({ ok: false, erreur: ligne }), 'moteur-surcharge', `« ${ligne} » non reconnue`);
  }
  // Un agent qui PARLE de la saturation n'en déclenche pas une.
  assert.equal(ligneDePanne('Le moteur a répondu « Selected model is at capacity ».'), null);
});

test('un bruit de fin de course ne remplace pas la cause réelle de l’arrêt', () => {
  const bruits = [
    'Reading additional input from stdin...',
    "Le moteur s'est arrêté (code 1).",
    "Le moteur s'est arrêté avant la fin.",
  ];
  for (const bruit of bruits) {
    assert.equal(diseLaCause(bruit), false, `« ${bruit} » ne dit rien de la cause`);
    assert.equal(
      causeLaPlusParlante('Selected model is at capacity. Please try a different model.', bruit),
      'Selected model is at capacity. Please try a different model.',
      `« ${bruit} » a écrasé la vraie cause`,
    );
  }
  // À défaut de cause connue, le bruit vaut mieux que rien.
  assert.equal(causeLaPlusParlante(undefined, 'Reading additional input from stdin...'), 'Reading additional input from stdin...');
  // Une cause qui arrive après une autre cause, elle, prend bien la main.
  assert.equal(causeLaPlusParlante('Erreur du moteur.', 'API Error: 500 Internal server error'), 'API Error: 500 Internal server error');
  assert.equal(diseLaCause('API Error: 500 Internal server error'), true);
});

test('la saturation du modèle, suivie du bruit de codex-cli, déclenche bien une relance', () => {
  // L'enchaînement exact vu dans le journal du 31/08 : la cause, puis la note
  // de démarrage que codex-cli écrit à chaque lancement.
  let cause: string | undefined;
  cause = causeLaPlusParlante(cause, 'Selected model is at capacity. Please try a different model.');
  cause = causeLaPlusParlante(cause, 'Reading additional input from stdin...');
  assert.equal(motifDePannePassagere({ ok: false, erreur: cause }), 'moteur-surcharge');
});


/* ------------------------------------------------------------------ */
/* Le serveur qui ne peut plus lancer de processus                      */
/* ------------------------------------------------------------------ */

/*
 * Relevé le 08.09.2026 : mémoire d'échange à 7 095 Mo sur 8 191, et
 * « EAGAIN: resource temporarily unavailable, posix_spawn '/usr/bin/node' » au
 * lancement. Ni le moteur ni son pont d'outils ne pouvaient naître — et rien ne
 * le disait : le tour tombait en échec muet, la carte restait figée.
 */

test('un `spawn EAGAIN` est reconnu comme une saturation de NOTRE serveur', () => {
  assert.equal(ligneDePanne('spawn /usr/bin/node EAGAIN'), 'machine-saturee');
  assert.equal(
    ligneDePanne("EAGAIN: resource temporarily unavailable, posix_spawn '/usr/bin/node'"),
    'machine-saturee',
  );
  assert.equal(ligneDePanne('Error: spawn node ENOMEM'), 'machine-saturee');
});

test('le message de lancement raté du démon est reconnu jusqu’à sa dernière ligne', () => {
  const message =
    'Le serveur n’a pas pu lancer un programme de plus : plus assez de mémoire ou de processus ' +
    'disponibles. Ce n’est pas une panne du moteur ni de la tâche — trop d’agents travaillent en ' +
    'même temps.\nspawn EAGAIN';
  assert.equal(motifDePannePassagere({ ok: false, erreur: message }), 'machine-saturee');
});

test('cette panne est celle de la MACHINE, pas du fournisseur', () => {
  assert.equal(panneDeLaMachine('machine-saturee'), true);
  assert.equal(panneDeLaMachine('erreur-serveur'), false);
  assert.equal(panneDeLaMachine(null), false);
  // Ce qui s'affiche ne renvoie pas l'utilisateur vers le moteur.
  assert.match(causeEnClair('machine-saturee'), /serveur/);
  assert.match(messageDePanneDefinitive('machine-saturee', 3), /serveur aura de nouveau de la place/);
});

test('une phrase qui PARLE de saturation n’est pas une saturation', () => {
  assert.equal(ligneDePanne('Le test vérifie que « EAGAIN » est bien reconnu'), null);
});

/* ------------------------------------------------------------------ */
/* Un tour refermé pendant l'attente ne pose plus de moteur orphelin    */
/* ------------------------------------------------------------------ */

/*
 * Relevé le 08.09.2026 sur le projet Beluga : 25 cartes sur 53 avaient au moins
 * un tour mort au MILIEU de leur travail. Le motif, dans les journaux, était
 * toujours le même — « panne passagère du moteur : nouvel essai 1 dans 5000 ms »
 * puis, trois secondes plus tard, « tour refermé d'autorité : le moteur s'est
 * arrêté sans rendre la main ». La veille refermait le tour PENDANT l'attente
 * de sa reprise. Le nouvel essai partait ensuite dans un tour déjà mort : ses
 * appels d'outils étaient refusés en rafale (« ce tour est terminé »), et le
 * moteur dépensait pour rien.
 *
 * Deux verrous, ici le second : la porte fermée arrête la boucle. Le premier —
 * la veille n'a plus le droit de refermer un tour en attente de reprise — vit
 * dans `fin-de-tour.test.ts`.
 */

test('un tour refermé pendant l’attente ne lance pas son essai suivant', async () => {
  const lancements: number[] = [];
  let referme = false;
  const relance = await lancerAvecRelances({
    lancer: (essai) => {
      lancements.push(essai);
      return { finished: Promise.resolve({ ok: false, error: 'Error: socket hang up' }) };
    },
    // La fermeture d'autorité ferme la porte exactement comme un arrêt à la main.
    etat: () => ({ erreur: undefined, texte: '', arretDemande: referme }),
    attendre: async () => {
      referme = true;
    },
  });

  assert.deepEqual(lancements, [0], 'aucun moteur n’est posé sur un tour refermé');
  assert.equal(relance.essais, 0, 'l’essai commencé puis abandonné n’est pas compté');
  assert.equal(relance.panne, 'lien-coupe', 'la panne reste dite');
});

/* ------------------------------------------------------------------ */
/* Le code 143 : SIGTERM, pas forcément notre bouton                    */
/* ------------------------------------------------------------------ */

/*
 * 143 = 128 + 15 : la signature de SIGTERM, quelle qu'en soit la main. Il était
 * écarté des pannes passagères au motif qu'il serait celui de notre propre
 * bouton d'arrêt. Faux : `systemctl restart` envoie SIGTERM à TOUT le groupe de
 * contrôle. Relevé le 30/08/2026 à 23:08:58 — « arrêt (SIGTERM) RETENU : une
 * publication est en cours » — puis, cinq secondes plus tard, trois moteurs
 * sortis en 143. Le démon avait refusé l'arrêt, ses trois tours sont morts sans
 * le moindre nouvel essai.
 */

test('un moteur emporté par SIGTERM (code 143) est une panne passagère', () => {
  assert.equal(ligneDePanne("Le moteur s'est arrêté (code 143)."), 'lien-coupe');
  // Les deux autres morts sans un mot restent reconnues.
  assert.equal(ligneDePanne("Le moteur s'est arrêté (code null)."), 'lien-coupe');
  assert.equal(ligneDePanne("Le moteur s'est arrêté (code 137)."), 'lien-coupe');
});

test('mais un arrêt DEMANDÉ à la main n’est jamais retenté, quel que soit son code', () => {
  // Le démon sait quand il a appuyé sur le bouton : il ne le devine pas d'un
  // code de sortie qu'il ne contrôle pas.
  assert.equal(
    motifDePannePassagere({
      ok: false,
      arretDemande: true,
      erreur: "Le moteur s'est arrêté (code 143).",
    }),
    null,
  );
});
