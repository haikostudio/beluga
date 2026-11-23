import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OUTILS_DE_L_ASSISTANT,
  CONSIGNE_ASSISTANT_GLOBAL,
  gesteIrreversible,
  lienDeLaCarte,
  chatAssistantRetenu,
  droiteDuRobot,
  genreDeLAppel,
  chatDeLAssistant,
  requeteDestructive,
} from '@beluga/shared';

test('une lecture passe toujours sans accord', () => {
  assert.equal(gesteIrreversible(genreDeLAppel('coffre_fort', { action: 'lister' })), false);
  assert.equal(gesteIrreversible(genreDeLAppel('assistant_messagerie', { action: 'en_attente' })), false);
  assert.equal(gesteIrreversible(genreDeLAppel('assistant_base_serveur', { mode: 'lecture' })), false);
});

test('une modification passe directement, comme pour un agent ordinaire', () => {
  const genre = genreDeLAppel('coffre_fort', { action: 'enregistrer' });
  assert.equal(genre, 'ecriture');
  assert.equal(gesteIrreversible(genre), false);
  for (const outil of ['board_create_card', 'propose_task', 'write_document', 'remember', 'make_archive']) {
    assert.equal(gesteIrreversible(genreDeLAppel(outil, {})), false, outil);
  }
});

test('proposer des suites n’est qu’une lecture : aucune question d’accord (capture #7db7)', () => {
  assert.equal(genreDeLAppel('proposer_suites', { suites: [] }), 'lecture');
  assert.equal(gesteIrreversible(genreDeLAppel('proposer_suites', {})), false);
});

test('sur un serveur, seule une requête qui efface des données attend l’accord', () => {
  assert.equal(requeteDestructive('UPDATE clients SET nom = 1 WHERE id = 2'), false);
  assert.equal(requeteDestructive('INSERT INTO notes VALUES (1)'), false);
  assert.equal(requeteDestructive('delete from notes where id = 3'), true);
  assert.equal(requeteDestructive('DROP TABLE notes'), true);
  assert.equal(requeteDestructive('ALTER TABLE notes DROP COLUMN x'), true);
  assert.equal(requeteDestructive('TRUNCATE notes'), true);
  assert.equal(requeteDestructive(''), true, 'une requête illisible compte comme destructive');
  assert.equal(gesteIrreversible(genreDeLAppel('assistant_base_serveur', { mode: 'ecriture', requete: 'UPDATE t SET a = 1' })), false);
  assert.equal(gesteIrreversible(genreDeLAppel('assistant_base_serveur', { mode: 'ecriture', requete: 'DELETE FROM t' })), true);
});

test('suppression, envoi au client et effacement sur un serveur demandent TOUJOURS l’accord', () => {
  const toujours: [string, Record<string, unknown>][] = [
    ['coffre_fort', { action: 'supprimer' }],
    ['board_delete_card', {}],
    ['marketing', { action: 'action', supprimer: true }],
    ['assistant_messagerie', { action: 'repondre' }],
    ['assistant_messagerie', { action: 'fil_envoyer' }],
    ['compta', { command: 'relance' }],
    ['assistant_base_serveur', { mode: 'ecriture', requete: 'DROP TABLE clients' }],
    ['assistant_messagerie', { action: 'creer' }],
    ['assistant_messagerie', { action: 'modifier' }],
    ['coffre_fort', { action: 'dossier_supprimer' }],
    ['assistant_base_serveur', {}],
    ['project_manage', { action: 'retirer' }],
  ];
  for (const [outil, args] of toujours) {
    assert.equal(gesteIrreversible(genreDeLAppel(outil, args)), true, `${outil} ${JSON.stringify(args)}`);
  }
});

test('un outil ou un geste inconnu est traité comme une suppression', () => {
  assert.equal(genreDeLAppel('Bash', {}), 'suppression');
  assert.equal(genreDeLAppel('coffre_fort', { action: 'vider' }), 'suppression');
  assert.equal(genreDeLAppel('compta', {}), 'suppression');
  assert.equal(gesteIrreversible(genreDeLAppel('outil_inconnu', {})), true);
});

test('chaque outil servi à l’assistant a une classification explicite', () => {
  // Un outil servi sans action reconnue ne doit jamais tomber en « lecture » par défaut.
  for (const outil of OUTILS_DE_L_ASSISTANT) {
    assert.notEqual(genreDeLAppel(outil, { action: 'inconnue', geste: 'inconnu', command: 'inconnue' }), undefined);
  }
});

test('plus aucun bouton « Autoriser » : l’assistant confirme lui-même l’irréversible par une question', () => {
  assert.doesNotMatch(CONSIGNE_ASSISTANT_GLOBAL, /Autoriser \/ Refuser/);
  assert.match(CONSIGNE_ASSISTANT_GLOBAL, /ask_user/);
  assert.match(CONSIGNE_ASSISTANT_GLOBAL, /« Oui, vas-y » et « Non »/);
  assert.doesNotMatch(CONSIGNE_ASSISTANT_GLOBAL, /Tu ne modifies jamais toi-même|tu ne redémarres jamais Beluga/);
});

test('l’assistant a ses gestes d’écran, et dit où est une carte avec un lien', () => {
  assert.ok((OUTILS_DE_L_ASSISTANT as readonly string[]).includes('assistant_gestes'));
  assert.equal(genreDeLAppel('assistant_gestes', { action: 'trouver' }), 'lecture');
  for (const action of ['lancer', 'valider_proposition', 'changer_de_projet', 'deployer', 'redemarrer']) {
    assert.equal(gesteIrreversible(genreDeLAppel('assistant_gestes', { action })), false, action);
  }
  assert.equal(genreDeLAppel('assistant_gestes', { action: 'inconnue' }), 'suppression');
  assert.equal(lienDeLaCarte('p1', 'c1'), '#projet/p1/tache/c1');
  assert.match(CONSIGNE_ASSISTANT_GLOBAL, /OÙ EST UNE CARTE/);
  assert.match(CONSIGNE_ASSISTANT_GLOBAL, /jamais de toi-même/);
});

test('le robot reste dans l’écran, dans le coin par défaut', () => {
  assert.equal(droiteDuRobot(undefined, 1440), 16);
  // L'ancienne place par défaut revient au coin ; une place glissée à la main reste.
  assert.equal(chatAssistantRetenu({ droite: 76 }).droite, 16);
  assert.equal(chatAssistantRetenu({ droite: 240 }).droite, 240);
  assert.equal(droiteDuRobot(-50, 1440), 8);
  assert.equal(droiteDuRobot(99999, 1440), 1440 - 8 - 48);
});

test('le chat suit le robot, au-dessus de lui, dans l’écran', () => {
  const ecran = { width: 1440, height: 900 };
  const vu = chatDeLAssistant({ ouvert: true, droite: 300, largeur: 420, hauteur: 600 }, ecran);
  assert.equal(vu.droite, 300);
  assert.equal(vu.bas, 16 + 48 + 8);
  // Robot tout à gauche : le chat est ramené dans l'écran.
  const gauche = chatDeLAssistant({ ouvert: true, droite: 1380, largeur: 420, hauteur: 600 }, ecran);
  assert.equal(gauche.droite, 1440 - 8 - 420);
  // Trop haut : borné à la place libre entre l'entête (44 px + marge) et le robot.
  assert.equal(chatDeLAssistant({ ouvert: true, droite: 76, largeur: 420, hauteur: 5000 }, ecran).hauteur, 900 - 72 - 44 - 8);
});

test('sur téléphone, le chat s’ouvre sous l’entête, pleine largeur, au-dessus du menu du bas', () => {
  const vu = chatDeLAssistant({ ouvert: true, droite: 300, largeur: 420, hauteur: 600 }, { width: 390, height: 844 });
  assert.equal(vu.largeur, 390 - 16);
  assert.equal(vu.droite, 8);
  // Ancré en haut, juste sous l'entête de 44 px (la zone sûre s'ajoute à l'écran).
  assert.equal(vu.haut, 44 + 8);
  assert.equal(vu.bas, 58 + 8);
  assert.equal(vu.hauteur, 844 - 52 - 66);
  // Sur ordinateur, aucun haut : le chat reste posé au-dessus du robot.
  assert.equal(chatDeLAssistant({ ouvert: true, droite: 76, largeur: 420, hauteur: 600 }, { width: 1440, height: 900 }).haut, undefined);
});

/* LE VOLET OUVERT PAR LE BOUTON DU BORD (carte « Jarvis : volet, voix et rapidité », 16/11/2026). */
test('sur ordinateur, le volet de l’assistant est toujours en bas à droite, à gauche du rond du terminal (17/11/2026)', async () => {
  const { voletDeLAssistant, CHAT_ASSISTANT_DEFAUT, DROITE_DE_JARVIS } = await import('@beluga/shared');
  const etat = { ...CHAT_ASSISTANT_DEFAUT, ouvert: true };
  const fenetre = { width: 1440, height: 900 };
  for (const bouton of [{ bord: 'gauche', centre: 400 }, { bord: 'droite', centre: 400 }, { bord: 'bas', centre: 1430 }, { bord: 'haut', centre: 200 }] as const) {
    const vu = voletDeLAssistant(etat, fenetre, bouton);
    assert.equal(vu.droite, DROITE_DE_JARVIS, bouton.bord);
    assert.equal(vu.gauche, undefined);
    assert.equal(vu.bas, 16, 'collé en bas');
    assert.equal(vu.haut, undefined);
    assert.equal(vu.poignee.horizontal, 'gauche');
  }
  assert.equal(DROITE_DE_JARVIS, 16, 'même marge qu’en bas (BAS_ROBOT)');
  // Sur téléphone, sous l'entête et pleine largeur, quel que soit le bord.
  const tel = voletDeLAssistant(etat, { width: 390, height: 844 }, { bord: 'droite', centre: 300 });
  assert.equal(tel.largeur, 390 - 16);
  assert.ok((tel.haut ?? 0) >= 44);
});
