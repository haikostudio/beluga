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
  DUREE_TOUR_ECLAIR_MS,
  RELEVES_EN_CHAINE_MAX,
  arretDuAuQuota,
  chaineAuRetourDuQuota,
  chaineDeReprise,
  FENETRE_SANS_ECHEANCE_MS,
  compteDeRepriseAutomatique,
  choixPossible,
  comptesDeReprise,
  demandeDeReprise,
  jugerRepriseSurCompte,
  ligneDeLimite,
  messageDeRefus,
  motifDArretQuota,
  questionEnTexteLibre,
  demandeDePassation,
  repriseSurUnAutreMoteur,
  repriseDepasseeParLeTour,
} from '@beluga/shared';

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

test('un clic sur un agent DÉJÀ REPARTI est refusé : jamais un second compte imposé par-dessus le premier', () => {
  const refus = jugerRepriseSurCompte({
    agentDejaReparti: true,
    engine: 'claude',
    compteEpuise: 'claude-pro',
    compte: { id: 'claude-max20', label: 'Max', engine: 'claude', disponible: true, releveFiable: true },
  });
  assert.equal(refus, 'agent-deja-reparti');
  assert.match(messageDeRefus(refus!), /déjà reparti/);
  /* Un choix déjà fait passe devant : c'est lui qui rend le double clic sans effet. */
  assert.equal(
    jugerRepriseSurCompte({ dejaChoisi: 'x', agentDejaReparti: true, engine: 'claude', compteEpuise: 'a' }),
    'deja-repris',
  );
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
    'agent-deja-reparti',
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
/* 3 bis. Reprendre sur un autre moteur ou un autre modèle             */
/* ------------------------------------------------------------------ */

test('LE CAS DU 13/09 : un seul autre compte Claude, à sec — le choix à la main propose les autres moteurs', () => {
  const reel: CompteConnu[] = [
    { id: 'claude-secondary', label: 'Claude Max x20', engine: 'claude', disponible: false },
    { id: 'claude-principal', label: 'Claude Pro', engine: 'claude', disponible: false },
    { id: 'codex-principal', label: 'Codex', engine: 'codex', disponible: true, consommePct: 30 },
    { id: 'cursor-cursor', label: 'Cursor', engine: 'cursor', disponible: true, consommePct: 5 },
  ];
  assert.equal(choixPossible(comptesDeReprise('claude', 'claude-secondary', reel)), false);
  const choix = comptesDeReprise('claude', 'claude-secondary', reel, { tousMoteurs: true });
  assert.equal(choixPossible(choix), true);
  assert.deepEqual(
    choix.map((c) => `${c.engine}:${c.id}`),
    ['cursor:cursor-cursor', 'codex:codex-principal', 'claude:claude-principal'],
  );
});

test('tous moteurs : à disponibilité égale, le moteur du tour passe devant', () => {
  const choix = comptesDeReprise('claude', 'claude-1', COMPTES, { tousMoteurs: true });
  assert.deepEqual(
    choix.map((c) => c.id),
    ['claude-3', 'claude-2', 'codex-1'],
  );
});

test('un CLIC peut prendre un compte d’un autre moteur ; la relève automatique, jamais', () => {
  assert.equal(jugerRepriseSurCompte({ ...base, moteurLibre: true, compte: COMPTES[4] }), null);
  assert.equal(jugerRepriseSurCompte({ ...base, compte: COMPTES[4] }), 'autre-moteur');
  assert.equal(compteDeRepriseAutomatique('claude', 'claude-1', [{ ...COMPTES[4], releveFiable: true }]), undefined);
  // Même libre de moteur, un compte à sec, coupé ou tombé reste refusé.
  assert.equal(jugerRepriseSurCompte({ ...base, moteurLibre: true, compte: { ...COMPTES[4], disponible: false } }), 'compte-epuise');
  assert.equal(jugerRepriseSurCompte({ ...base, moteurLibre: true, compte: { ...COMPTES[0], disponible: true } }), 'meme-compte');
});

test('seul un changement de MOTEUR réclame une passation écrite', () => {
  assert.equal(repriseSurUnAutreMoteur({ engine: 'claude' }, { engine: 'codex' }), true);
  assert.equal(repriseSurUnAutreMoteur({ engine: 'claude' }, { engine: 'claude' }), false);
});

test('la PASSATION d’un fil neuf porte la branche, le plan, les étapes et les derniers textes', () => {
  const texte = demandeDePassation({
    compteEpuise: 'Claude Max x20',
    compteChoisi: 'Codex',
    moteurAvant: 'Claude',
    moteurApres: 'Codex',
    modele: 'gpt-5.6-sol',
    dossier: '/root/beluga/.worktrees/base-99af66',
    branche: 'tache/base-99af66',
    plan: '# Plan\n1. Schéma\n2. Écran',
    taches: [
      { label: 'Schéma des unités', state: 'done' },
      { label: 'Écran Mémoire', state: 'todo' },
    ],
    derniersEchanges: ['Le schéma est en place, reste l’écran.'],
  });
  assert.match(texte, /Claude Max x20/);
  assert.match(texte, /sous Codex \(modèle gpt-5\.6-sol\)/);
  assert.match(texte, /branche « tache\/base-99af66 »/);
  assert.match(texte, /PLAN RETENU :\n# Plan/);
  assert.match(texte, /- \[x\] Schéma des unités/);
  assert.match(texte, /- \[ \] Écran Mémoire/);
  assert.match(texte, /reste l’écran/);
  assert.match(texte, /Ne recommence pas/);
});

test('une passation sans plan ni tâches n’écrit aucun bloc vide', () => {
  const texte = demandeDePassation({
    compteEpuise: 'A',
    compteChoisi: 'B',
    moteurAvant: 'Claude',
    moteurApres: 'Cursor',
    taches: [],
    derniersEchanges: [],
  });
  assert.doesNotMatch(texte, /PLAN RETENU|ÉTAPES|DÉPÔT|undefined/);
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

/* ------------------------------------------------------------------ */
/* 4. La relève ne boucle plus                                         */
/* ------------------------------------------------------------------ */

test('le manque de crédits est reconnu comme une limite : « requires usage credits »', () => {
  assert.equal(
    ligneDeLimite('Fable 5.1 requires usage credits. Switch to another model, or manage usage credits at claude.ai/settings/usage, to continue.'),
    true,
  );
  assert.equal(ligneDeLimite('Insufficient credits for this request'), true);
  assert.equal(ligneDeLimite('Your usage credits are exhausted'), true);
  assert.equal(
    motifDArretQuota({ ok: false, erreur: 'code 1', texte: 'Fable 5.1 requires usage credits. Switch to another model to continue.' }),
    'texte-de-limite',
  );
});

test('un premier arrêt ouvre une chaîne d’un seul compte, sans relève derrière lui', () => {
  assert.deepEqual(chaineDeReprise({ precedente: null, compteEpuise: 'A', dureeDuTourMs: 10_000 }), {
    comptesEssayes: ['A'],
    relevesEnChaine: 0,
  });
  // Une reprise ABANDONNÉE ne tient plus la chaîne : le tour d'après repart à neuf.
  assert.deepEqual(
    chaineDeReprise({
      precedente: { compteEpuise: 'A', choisi: 'B', abandonnee: true },
      compteEpuise: 'B',
      dureeDuTourMs: 10_000,
    }),
    { comptesEssayes: ['B'], relevesEnChaine: 0 },
  );
  // Une reprise sans compte retenu non plus : rien n'a été décidé.
  assert.deepEqual(
    chaineDeReprise({ precedente: { compteEpuise: 'A' }, compteEpuise: 'B', dureeDuTourMs: 10_000 }),
    { comptesEssayes: ['B'], relevesEnChaine: 0 },
  );
});

test('un tour reparti sur un AUTRE compte que celui choisi allonge quand même la chaîne', () => {
  /*
   * LE 06.09.2026 : dix questions de compte d'affilée sur le même agent. À
   * chaque fois « Claude Max x20 » était choisi, à chaque fois le tour repartait
   * sur « Claude Pro » — le compte imposé se perdait dans la file — et à chaque
   * fois la chaîne repartait de zéro, puisqu'elle exigeait que le compte tombé
   * soit celui qu'on avait retenu. Rien n'arrêtait plus l'enchaînement.
   *
   * Le lien qui fait la chaîne est la DÉCISION, pas le compte qui l'a suivie.
   */
  assert.deepEqual(
    chaineDeReprise({ precedente: { compteEpuise: 'A', choisi: 'C' }, compteEpuise: 'A', dureeDuTourMs: 10_000 }),
    { comptesEssayes: ['A', 'C'], relevesEnChaine: 1 },
  );
  // Le compte CHOISI rejoint les essayés au même titre que celui qui est tombé :
  // la relève automatique ne le repropose pas au tour suivant.
  assert.deepEqual(
    chaineDeReprise({ precedente: { compteEpuise: 'A', choisi: 'C' }, compteEpuise: 'B', dureeDuTourMs: 10_000 }),
    { comptesEssayes: ['A', 'C', 'B'], relevesEnChaine: 1 },
  );
});

test('une relève tombée AUSSITÔT allonge la chaîne : les deux comptes sont essayés', () => {
  const chaine = chaineDeReprise({
    precedente: { compteEpuise: 'A', choisi: 'B' },
    compteEpuise: 'B',
    dureeDuTourMs: DUREE_TOUR_ECLAIR_MS - 1,
  });
  assert.deepEqual(chaine, { comptesEssayes: ['A', 'B'], relevesEnChaine: 1 });
  // Et la chaîne se prolonge, sans doublon.
  const suite = chaineDeReprise({
    precedente: { compteEpuise: 'B', choisi: 'A', comptesEssayes: ['A', 'B'], relevesEnChaine: 1 },
    compteEpuise: 'A',
    dureeDuTourMs: 5_000,
  });
  assert.deepEqual(suite, { comptesEssayes: ['A', 'B'], relevesEnChaine: 2 });
});

test('une relève qui a TENU n’est pas une boucle : les comptes d’avant redeviennent candidats', () => {
  const chaine = chaineDeReprise({
    precedente: { compteEpuise: 'A', choisi: 'B', comptesEssayes: ['A'] },
    compteEpuise: 'B',
    dureeDuTourMs: DUREE_TOUR_ECLAIR_MS,
  });
  assert.deepEqual(chaine, { comptesEssayes: ['B'], relevesEnChaine: 0 });
});

test('la relève automatique ne repuise jamais dans la chaîne, et rend la main au bout de trois', () => {
  const comptes: CompteConnu[] = [
    { id: 'A', label: 'A', engine: 'claude', disponible: true, releveFiable: true },
    { id: 'B', label: 'B', engine: 'claude', disponible: true, releveFiable: true },
  ];
  // A vient de tomber : B prend.
  assert.equal(compteDeRepriseAutomatique('claude', ['A'], comptes)?.id, 'B');
  // A puis B sont tombés d'affilée : plus personne, même si le relevé dit B disponible.
  assert.equal(compteDeRepriseAutomatique('claude', ['A', 'B'], comptes), undefined);
  // L'ancienne forme (un seul compte) marche toujours.
  assert.equal(compteDeRepriseAutomatique('claude', 'B', comptes)?.id, 'A');
  // Au-delà du nombre de relèves permis, la main est rendue quoi qu'il reste.
  assert.equal(compteDeRepriseAutomatique('claude', ['A'], comptes, RELEVES_EN_CHAINE_MAX), undefined);
  assert.equal(compteDeRepriseAutomatique('claude', ['A'], comptes, RELEVES_EN_CHAINE_MAX - 1)?.id, 'B');
});

/* ------------------------------------------------------------------ */
/* Le retour du quota : la carte repart seule                          */
/* ------------------------------------------------------------------ */

test('un seul compte : la fenêtre a tourné, il redevient candidat et la chaîne repart de zéro', () => {
  const reprise = { compteEpuise: 'A', comptesEssayes: ['A'], relevesEnChaine: 2, resetsAt: 10_000, at: 1_000 };
  const seul: CompteConnu[] = [{ id: 'A', label: 'A', engine: 'claude', disponible: true, releveFiable: true }];
  // Avant l'heure : rien ne change, le compte tombé reste exclu.
  const avant = chaineAuRetourDuQuota(reprise, 9_999);
  assert.deepEqual(avant, { comptesEssayes: ['A'], relevesEnChaine: 2, fenetreNeuve: false });
  assert.equal(compteDeRepriseAutomatique('claude', avant.comptesEssayes, seul, avant.relevesEnChaine), undefined);
  // Après l'heure : fenêtre neuve, il reprend le travail.
  const apres = chaineAuRetourDuQuota(reprise, 10_000);
  assert.deepEqual(apres, { comptesEssayes: [], relevesEnChaine: 0, fenetreNeuve: true });
  assert.equal(compteDeRepriseAutomatique('claude', apres.comptesEssayes, seul, apres.relevesEnChaine)?.id, 'A');
});

test('une fenêtre neuve ne rend pas disponible un compte que le relevé ou une limite connue écarte', () => {
  const apres = chaineAuRetourDuQuota({ compteEpuise: 'A', resetsAt: 10_000, at: 1_000 }, 20_000);
  const refuse: CompteConnu[] = [{ id: 'A', label: 'A', engine: 'claude', disponible: false, releveFiable: true }];
  assert.equal(compteDeRepriseAutomatique('claude', apres.comptesEssayes, refuse, apres.relevesEnChaine), undefined);
});

test('sans heure de remise à zéro connue, l’échéance par défaut d’une limite fait foi', () => {
  const reprise = { compteEpuise: 'A', at: 1_000 };
  assert.equal(chaineAuRetourDuQuota(reprise, 1_000 + FENETRE_SANS_ECHEANCE_MS - 1).fenetreNeuve, false);
  assert.equal(chaineAuRetourDuQuota(reprise, 1_000 + FENETRE_SANS_ECHEANCE_MS).fenetreNeuve, true);
  // Une heure déjà passée AU MOMENT de la limite ne dit rien de la fenêtre suivante.
  assert.equal(chaineAuRetourDuQuota({ ...reprise, resetsAt: 500 }, 2_000).fenetreNeuve, false);
});

test('deux comptes : l’autre compte se libère avant la remise à zéro, il prend la relève', () => {
  const reprise = { compteEpuise: 'A', comptesEssayes: ['A'], relevesEnChaine: 0, resetsAt: 10_000, at: 1_000 };
  const deux: CompteConnu[] = [
    { id: 'A', label: 'A', engine: 'claude', disponible: true, releveFiable: true },
    { id: 'B', label: 'B', engine: 'claude', disponible: true, releveFiable: true },
  ];
  const chaine = chaineAuRetourDuQuota(reprise, 5_000);
  assert.equal(compteDeRepriseAutomatique('claude', chaine.comptesEssayes, deux, chaine.relevesEnChaine)?.id, 'B');
});

test('le retour du quota ne lève pas le plafond d’un rebond A → B → A rapproché', () => {
  // A tombe, B relève et tombe en moins de 3 min, A relève et tombe : troisième relève.
  let chaine = chaineDeReprise({ precedente: null, compteEpuise: 'A', dureeDuTourMs: DUREE_TOUR_ECLAIR_MS + 1 });
  let precedente = { compteEpuise: 'A', choisi: 'B', ...chaine };
  for (const tombe of ['B', 'A', 'B']) {
    chaine = chaineDeReprise({ precedente, compteEpuise: tombe, dureeDuTourMs: 10_000 });
    precedente = { compteEpuise: tombe, choisi: tombe === 'A' ? 'B' : 'A', ...chaine };
  }
  assert.equal(chaine.relevesEnChaine, RELEVES_EN_CHAINE_MAX);
  const auRetour = chaineAuRetourDuQuota({ ...precedente, resetsAt: 60_000, at: 1_000 }, 30_000);
  const libres: CompteConnu[] = [
    { id: 'A', label: 'A', engine: 'claude', disponible: true, releveFiable: true },
    { id: 'B', label: 'B', engine: 'claude', disponible: true, releveFiable: true },
  ];
  assert.equal(compteDeRepriseAutomatique('claude', auRetour.comptesEssayes, libres, auRetour.relevesEnChaine), undefined);
});

test('un tour reparti SANS clic referme les reprises ouvertes de son agent, pas celles des autres', () => {
  const attente = { agentId: 'a1', messageId: 'm1' };
  assert.equal(repriseDepasseeParLeTour(attente, { agentId: 'a1' }), true);
  /* Le tour de la reprise elle-même la consomme par son propre chemin. */
  assert.equal(repriseDepasseeParLeTour(attente, { agentId: 'a1', repriseDe: 'm1' }), false);
  assert.equal(repriseDepasseeParLeTour(attente, { agentId: 'a2' }), false);
});

test('la reprise après quota emporte la demande ENTIÈRE du tour coupé (carte 5e10116a)', () => {
  const prompt = 'DÉCOUPE DU TRAVAIL :\n1. Marge du bas à 16 px\n2. Onglets des Tableaux de bord\n9. Volet des tâches';
  const avant = demandeDeReprise('Claude Perso', 'Claude Pro', { prompt, travailCommence: false });
  assert.ok(avant.includes(prompt), 'le prompt entier est recopié');
  assert.match(avant, /DEMANDE DE CE TOUR/);
  assert.match(avant, /TU ES TOMBÉ AVANT D'AVOIR TRAITÉ LA DEMANDE/);
  assert.match(avant, /nomme celui qui n'a pas pu être fait/);
  const pendant = demandeDeReprise('Claude Perso', 'Claude Pro', { prompt, travailCommence: true });
  assert.ok(pendant.includes(prompt));
  assert.match(pendant, /CONTINUE EXACTEMENT/);
  assert.match(pendant, /conversation vide/);
});

test('la passation vers un autre moteur emporte aussi la demande du tour', () => {
  const texte = demandeDePassation({
    compteEpuise: 'A',
    compteChoisi: 'B',
    moteurAvant: 'Claude',
    moteurApres: 'Codex',
    taches: [],
    derniersEchanges: [],
    demandeDuTour: 'Refaire les onglets du téléphone',
  });
  assert.match(texte, /Refaire les onglets du téléphone/);
  assert.match(texte, /DEMANDE DE CE TOUR/);
});
