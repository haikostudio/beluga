/**
 * Reprendre une tâche sur un autre compte après épuisement.
 *
 * Trois règles, toutes pures, donc rejouées ici sans base, sans démon et sans
 * toucher au moindre compte réel : reconnaître un arrêt dû au quota, classer
 * les comptes sur lesquels poursuivre, juger le clic au moment où il tombe.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CompteConnu,
  arretDuAuQuota,
  choixPossible,
  comptesDeReprise,
  demandeDeReprise,
  jugerRepriseSurCompte,
  ligneDeLimite,
  messageDeRefus,
  motifDArretQuota,
  questionEnTexteLibre,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* 1. Reconnaître l'arrêt                                              */
/* ------------------------------------------------------------------ */

test('une limite STRUCTURÉE annoncée par le moteur suffit', () => {
  assert.equal(
    motifDArretQuota({ ok: false, limiteSignalee: true, erreur: "Le moteur s'est arrêté (code 1)." }),
    'limite-structuree',
  );
});

test('le TEXTE de la capture est reconnu : « You’ve hit your session limit »', () => {
  const texte = [
    'Maintenant la mention sur la carte du tableau.',
    '',
    "You've hit your session limit · resets 1:20pm (Europe/Paris)",
  ].join('\n');
  assert.equal(motifDArretQuota({ ok: false, erreur: "Le moteur s'est arrêté (code 1).", texte }), 'texte-de-limite');
});

test('les autres tournures des moteurs sont reconnues', () => {
  for (const ligne of [
    "You've hit your usage limit",
    'Claude AI usage limit reached|1754000000',
    'You have reached your weekly limit',
    'Error: rate limit exceeded',
    'You have exceeded your usage limit for today',
    "Limite d'utilisation atteinte",
  ]) {
    assert.equal(ligneDeLimite(ligne), true, ligne);
  }
});

test('un tour RÉUSSI n’est jamais un arrêt de quota, même s’il en parle', () => {
  assert.equal(
    motifDArretQuota({ ok: true, texte: "You've hit your session limit · resets 1:20pm" }),
    null,
  );
});

test('un ARRÊT DEMANDÉ à la main reste un arrêt manuel', () => {
  assert.equal(
    motifDArretQuota({ ok: false, arretDemande: true, limiteSignalee: true, texte: 'peu importe' }),
    null,
  );
});

test('une panne ordinaire reste un échec ordinaire', () => {
  assert.equal(motifDArretQuota({ ok: false, erreur: "Le moteur s'est arrêté (code 1)." }), null);
  assert.equal(motifDArretQuota({ ok: false, erreur: 'tsc: not found' }), null);
  assert.equal(motifDArretQuota({ ok: false, texte: 'La construction a échoué : 3 erreurs de types.' }), null);
});

test('FAUX POSITIFS : un agent qui PARLE des limites n’en déclenche aucune', () => {
  // Une citation entre guillemets : c'est un exemple, pas une bannière.
  assert.equal(ligneDeLimite('J’ai ajouté la détection du texte « You’ve hit your session limit ».'), false);
  assert.equal(ligneDeLimite('Le test vérifie que "usage limit reached" est reconnu.'), false);
  assert.equal(ligneDeLimite('`rate limit exceeded` est traité dans le fichier partagé.'), false);
  // Une phrase entière : la tournure arrive bien trop loin dans la ligne.
  assert.equal(
    ligneDeLimite(
      'Après avoir lu le code des quotas et vérifié le comportement de chaque moteur, ' +
        'je constate que la bannière hit your session limit apparaît en fin de tour.',
    ),
    false,
  );
  // Et surtout : au MILIEU du compte rendu, jamais sur les deux dernières lignes.
  const compteRendu = [
    "La bannière « You've hit your session limit » est désormais reconnue.",
    '',
    '## 2. Ce qui est fait',
    'La détection est branchée sur la fin de tour.',
  ].join('\n');
  assert.equal(motifDArretQuota({ ok: false, erreur: 'échec de construction', texte: compteRendu }), null);
});

test('une ligne trop longue n’est pas une bannière de moteur', () => {
  assert.equal(ligneDeLimite(`${"You've hit your session limit "}${'x'.repeat(220)}`), false);
});

test('le raccourci de lecture dit la même chose que le motif', () => {
  assert.equal(arretDuAuQuota({ ok: false, limiteSignalee: true }), true);
  assert.equal(arretDuAuQuota({ ok: false }), false);
});

/* ------------------------------------------------------------------ */
/* 2. Les comptes proposés                                             */
/* ------------------------------------------------------------------ */

const COMPTES: CompteConnu[] = [
  { id: 'claude-1', label: 'Claude — x20', engine: 'claude', disponible: false, consommePct: 100 },
  { id: 'claude-2', label: 'Claude — Pro', engine: 'claude', disponible: true, consommePct: 40 },
  { id: 'claude-3', label: 'Claude — relève', engine: 'claude', disponible: true, consommePct: 12 },
  { id: 'claude-4', label: 'Claude — coupé', engine: 'claude', disponible: true, coupe: true },
  { id: 'codex-1', label: 'Codex — principal', engine: 'codex', disponible: true },
];

test('les autres comptes du MÊME moteur, le moins consommé d’abord', () => {
  const choix = comptesDeReprise('claude', 'claude-1', COMPTES);
  assert.deepEqual(
    choix.map((c) => c.id),
    ['claude-3', 'claude-2'],
  );
  assert.equal(choixPossible(choix), true);
});

test('jamais le compte tombé, jamais un compte coupé, jamais un autre moteur', () => {
  const choix = comptesDeReprise('claude', 'claude-1', COMPTES);
  assert.equal(choix.some((c) => c.id === 'claude-1'), false);
  assert.equal(choix.some((c) => c.id === 'claude-4'), false);
  assert.equal(choix.some((c) => c.id === 'codex-1'), false);
});

test('aucun compte libre : la liste reste, marquée indisponible', () => {
  const asec: CompteConnu[] = [
    { id: 'claude-1', label: 'x20', engine: 'claude', disponible: false },
    { id: 'claude-2', label: 'Pro', engine: 'claude', disponible: false, resetsAt: 1_000 },
  ];
  const choix = comptesDeReprise('claude', 'claude-1', asec);
  assert.equal(choix.length, 1);
  assert.equal(choixPossible(choix), false);
  assert.equal(choix[0].resetsAt, 1_000);
});

test('un seul compte déclaré : aucun choix, et on le dit', () => {
  const choix = comptesDeReprise('claude', 'claude-1', [COMPTES[0]]);
  assert.deepEqual(choix, []);
  assert.equal(choixPossible(choix), false);
});

/* ------------------------------------------------------------------ */
/* 3. Le clic                                                          */
/* ------------------------------------------------------------------ */

const base = { engine: 'claude', compteEpuise: 'claude-1' };

test('un compte encore disponible laisse partir la reprise', () => {
  assert.equal(jugerRepriseSurCompte({ ...base, compte: COMPTES[1] }), null);
});

test('DOUBLE CLIC : une décision déjà tranchée ne relance rien', () => {
  const refus = jugerRepriseSurCompte({ ...base, dejaChoisi: 'claude-2', compte: COMPTES[1] });
  assert.equal(refus, 'deja-repris');
  assert.match(messageDeRefus(refus!), /déjà repris/i);
});

test('un compte devenu indisponible AU CLIC ne lance rien', () => {
  assert.equal(
    jugerRepriseSurCompte({ ...base, compte: { ...COMPTES[1], disponible: false } }),
    'compte-epuise',
  );
});

test('un compte coupé entre-temps, disparu, ou d’un autre moteur : refusé', () => {
  assert.equal(jugerRepriseSurCompte({ ...base, compte: { ...COMPTES[1], coupe: true } }), 'compte-coupe');
  assert.equal(jugerRepriseSurCompte({ ...base, compte: undefined }), 'compte-inconnu');
  assert.equal(jugerRepriseSurCompte({ ...base, compte: COMPTES[4] }), 'autre-moteur');
});

test('on ne repart jamais sur le compte qui vient de tomber', () => {
  assert.equal(
    jugerRepriseSurCompte({ ...base, compte: { ...COMPTES[0], disponible: true } }),
    'meme-compte',
  );
});

test('chaque refus se dit en français simple', () => {
  for (const refus of [
    'deja-repris',
    'compte-inconnu',
    'autre-moteur',
    'compte-coupe',
    'compte-epuise',
    'meme-compte',
  ] as const) {
    const texte = messageDeRefus(refus);
    assert.ok(texte.length > 20, refus);
    assert.ok(!/undefined|null/.test(texte), refus);
  }
});

/* ------------------------------------------------------------------ */
/* 4. La demande de reprise                                            */
/* ------------------------------------------------------------------ */

test('la demande dit de CONTINUER, jamais de recommencer', () => {
  const demande = demandeDeReprise('Claude — x20', 'Claude — Pro');
  assert.match(demande, /Claude — x20/);
  assert.match(demande, /Claude — Pro/);
  assert.match(demande, /CONTINUE EXACTEMENT OÙ TU T'ES ARRÊTÉ/);
  assert.match(demande, /Ne recommence pas/);
});

/* ------------------------------------------------------------------ */
/* 5. Une décision est comptée à UN SEUL endroit                       */
/* ------------------------------------------------------------------ */

test('un tour en attente de compte ne compte pas AUSSI comme question écrite', () => {
  const message = {
    role: 'assistant' as const,
    content: 'Je bute sur la limite. Faut-il poursuivre sur un autre compte ?',
    repriseCompte: { engine: 'claude', compteEpuise: 'claude-1' },
  };
  // Sans la reprise, la phrase finale serait bien comptée comme une question.
  assert.ok(questionEnTexteLibre({ role: message.role, content: message.content }));
  assert.equal(questionEnTexteLibre(message), null);
});
