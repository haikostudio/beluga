import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSIGNE_DE_VULGARISATION,
  CONSIGNE_DES_DATES,
  RAPPEL_DE_VULGARISATION,
  FORME_DE_LA_COMPREHENSION,
  CONSIGNE_CADRAGE,
  consigneDeRenduDuPlan,
  contexteDeDepart,
  lirePlanRendu,
  rendrePlan,
  wrapPrompt,
} from '@beluga/shared';
import { rolePrompt, rappelDeMethode } from '../runtime.js';
import { TOOL_DEFS as TOOLS } from '../tools.js';

/* ------------------------------------------------------------------ */
/* Tout ce que l'utilisateur lit d'un agent est vulgarisé               */
/* ------------------------------------------------------------------ */

/*
 * L'utilisateur ne programme pas. La consigne « Réponds en phrases simples »
 * était une demi-phrase que l'agent de cadrage ne recevait même pas. Une seule
 * consigne, posée après la langue sur TOUS les accueils ; et le détail
 * technique change de destinataire (notes techniques du plan, mémoire,
 * enregistrements) au lieu de disparaître.
 */

const ROLES = ['cadrage', 'analysis', 'deploy', 'task'] as const;
const MOTEURS = ['claude', 'codex'] as const;

test('la consigne dit pour qui on écrit, ce qu’on évite, et où va le détail technique', () => {
  assert.match(CONSIGNE_DE_VULGARISATION, /ne programme pas/);
  assert.match(CONSIGNE_DE_VULGARISATION, /nom de fichier, de fonction/);
  assert.match(CONSIGNE_DE_VULGARISATION, /adulte à adulte/);
  assert.match(CONSIGNE_DE_VULGARISATION, /notes techniques du plan/);
  /* Elle part à chaque tour : elle reste brève. */
  assert.ok(CONSIGNE_DE_VULGARISATION.length < 1000, `${CONSIGNE_DE_VULGARISATION.length} signes`);
});

test('tous les rôles et les deux moteurs la reçoivent juste après la langue, à l’identique', () => {
  for (const role of ROLES) {
    const parMoteur = MOTEURS.map((engine) => rolePrompt(role, false, engine));
    for (const p of parMoteur) {
      const [langue, suite] = [p.split('\n')[0], p.split('\n')[1]];
      assert.match(langue, /^LANGUE DE TES RÉPONSES/, role);
      assert.equal(suite, CONSIGNE_DE_VULGARISATION, role);
    }
  }
});

test('le dépannage de publication et l’assistant des backups la reçoivent aussi', () => {
  assert.ok(rolePrompt('task', false, 'claude', 'minimal').includes(CONSIGNE_DE_VULGARISATION));
  assert.ok(rolePrompt('task', false, 'claude', 'complet', 'configuration-backup').includes(CONSIGNE_DE_VULGARISATION));
});

test('l’ancienne demi-phrase a disparu, et le rappel des tours suivants redit la règle', () => {
  assert.doesNotMatch(rolePrompt('task', false, 'claude'), /pour un lecteur non technique/);
  for (const engine of MOTEURS) assert.ok(rappelDeMethode(engine).includes(RAPPEL_DE_VULGARISATION), engine);
});

test('la compréhension et son outil demandent un texte sans nom technique', () => {
  assert.match(FORME_DE_LA_COMPREHENSION, /ne programme pas/);
  const outil = TOOLS.find((t) => t.name === 'rendre_comprehension') as any;
  assert.match(outil.inputSchema.properties.texte.description, /ne programme pas/);
});

test('la compréhension demande du fond, plus un gabarit — et le langage courant reste exigé', () => {
  /* Le gabarit à trois parties (sommaire numéroté, « Comment », « Résultat »)
     donnait des compréhensions squelettiques : il ne doit pas revenir. */
  assert.doesNotMatch(FORME_DE_LA_COMPREHENSION, /LISTE NUMÉROTÉE|TROIS PARTIES|« Comment : … »|« Résultat : … »/);
  // La compréhension se range en points titrés, sommaire en tête, rien au-dessus (06/11/2026).
  assert.match(FORME_DE_LA_COMPREHENSION, /IL EST RANGÉ EN POINTS/);
  assert.match(FORME_DE_LA_COMPREHENSION, /RIEN au-dessus du premier titre/);
  assert.match(FORME_DE_LA_COMPREHENSION, /Ni tableau, ni liste à puces/);
  assert.match(FORME_DE_LA_COMPREHENSION, /aucun nom de fichier, de fonction ni de technologie/);
});

test('la compréhension est un message qui dit ce qui va être fait, sans redire la demande', () => {
  /* Refusé le 22/09/2026 : des pavés qui reformulaient la demande. Décidé le
     17/10/2026 : un message qui ne dit ensuite que ce qui change ; le constat
     détaillé part dans la part technique. Le 25/10/2026, le plafond de 600
     signes tombe : la longueur suit ce qu'il y a à dire. Le 13/11/2026, la
     compréhension redevient COMPLÈTE à chaque échange ; l'écran marque en
     violet ce qui a changé. */
  assert.match(FORME_DE_LA_COMPREHENSION, /ce que tu vas faire/);
  assert.match(FORME_DE_LA_COMPREHENSION, /Tu NE REDIS PAS la demande/);
  assert.doesNotMatch(FORME_DE_LA_COMPREHENSION, /600 signes|REFUSE un texte plus long/);
  assert.match(FORME_DE_LA_COMPREHENSION, /longueur que la situation appelle/);
  assert.match(FORME_DE_LA_COMPREHENSION, /TOUJOURS la compréhension COMPLÈTE/);
  assert.doesNotMatch(FORME_DE_LA_COMPREHENSION, /SEULEMENT ce qui change|réénumères/);
  assert.doesNotMatch(CONSIGNE_CADRAGE, /dit ce qui change depuis elle/);
  assert.match(FORME_DE_LA_COMPREHENSION, /partieTechnique/);
  assert.doesNotMatch(FORME_DE_LA_COMPREHENSION, /DÉVELOPPÉ|TOUTE la conversation|VA AU FOND/);
  assert.doesNotMatch(CONSIGNE_CADRAGE, /REPREND TOUT|600 signes|t'est renvoyé une fois pour être raccourci/);
  assert.match(CONSIGNE_CADRAGE, /PARLE COMME DANS UNE DISCUSSION/);
  /* Tous les agents : la consigne de ton, posée après la langue, le dit aussi. */
  assert.match(CONSIGNE_DE_VULGARISATION, /jamais de reformulation de sa demande/);
  assert.match(RAPPEL_DE_VULGARISATION, /sans redire sa demande/);
});

test('le plan affiché est simple, ses notes techniques partent à l’agent d’exécution sans s’afficher', () => {
  assert.match(consigneDeRenduDuPlan(1), /notesTechniques/);
  const outil = TOOLS.find((t) => t.name === 'rendre_plan') as any;
  assert.ok(outil.inputSchema.properties.notesTechniques);
  assert.ok(outil.inputSchema.required.includes('enClair'), 'l’ouverture « En clair » est exigée par l’outil');
  /* LE CAHIER VIVANT (17/10/2026) : facultatif dans l'outil, repris de la carte s'il manque. */
  assert.ok(outil.inputSchema.properties.cahierDesCharges);
  assert.ok(!outil.inputSchema.required.includes('cahierDesCharges'));
  assert.ok(outil.inputSchema.required.includes('verifications'));
  assert.match(consigneDeRenduDuPlan(1), /cahierDesCharges/);
  assert.match(consigneDeRenduDuPlan(1), /enClair/);
  const lecture = lirePlanRendu({
    titre: 'Essai',
    enClair: 'Je vais faire en sorte que l’en-tête de la page reste toujours visible en haut, même quand vous descendez dans un long contenu. Une fois en place, vous n’aurez plus à remonter pour retrouver le menu : il vous suit. Cela vous fera gagner du temps sur les pages longues, surtout sur téléphone.',
    cahierDesCharges: [
      { titre: 'Contexte et objectifs', contenu: 'Garder le menu à portée.' },
      { titre: 'Pour qui', contenu: 'Les lecteurs de pages longues.' },
      { titre: 'Périmètre', contenu: 'L’en-tête seulement.' },
      { titre: 'Critères de réussite', contenu: 'Il reste visible.' },
    ],
    synthese: 'Un essai.',
    taches: [{ titre: 'Un', description: 'd' }, { titre: 'Deux', description: 'd' }],
    decisions: ['rien à trancher'],
    verifications: ['Il reste visible en défilant.'],
    faisabilite: 'faisable',
    chemin: [{ titre: 'a', detail: 'x' }, { titre: 'b', detail: 'y' }],
    consequences: 'aucune',
    ameliorations: ['plus tard'],
    notesTechniques: 'server/src/runtime.ts : rolePrompt',
  });
  assert.ok(lecture.ok);
  if (!lecture.ok) return;
  const texte = rendrePlan(lecture.valeur);
  assert.doesNotMatch(texte, /runtime\.ts/);
  const contexte = contexteDeDepart([], [], { numero: 1, texte, notesTechniques: lecture.valeur.notesTechniques });
  assert.match(contexte, /NOTES TECHNIQUES DU PLAN[\s\S]*runtime\.ts : rolePrompt[\s\S]*FIN DU PLAN RETENU/);
});

test('les gabarits de compte rendu demandent ce qui change pour l’utilisateur, pas les fichiers touchés', () => {
  for (const kind of ['in_run', 'pre_run', 'deploy', 'deploy_batch', 'free'] as const) {
    assert.match(wrapPrompt(kind, 'une vraie demande assez longue pour un compte rendu complet'), /ne programme pas/, kind);
  }
});

test('tous les agents comparent une date à celle du jour avant de situer un événement passé', () => {
  /* « La correction de la semaine dernière » pour une correction du matin. */
  assert.match(CONSIGNE_DES_DATES, /date du jour/);
  assert.doesNotMatch(CONSIGNE_DES_DATES, /\d{4}-\d{2}-\d{2}/, 'statique : la consigne système ne porte aucune date');
  for (const role of ROLES) {
    for (const engine of MOTEURS) assert.equal(rolePrompt(role, false, engine).split('\n')[2], CONSIGNE_DES_DATES, `${role} ${engine}`);
  }
});
