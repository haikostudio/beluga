/*
 * CARTE « Ménage de la mémoire de la voix » (18/11/2026) : ce que la voix apprend de l'appel du matin (DISC-0038).
 *  - « coupe-toi » ferme pour de bon, même au milieu d'une phrase longue ; « coupe la vidéo » ne ferme rien ;
 *  - une annonce de Jarvis (« je me coupe », « Entendu, j'arrête. ») ferme aussi : une parole n'est pas une action ;
 *  - (carte « Jarvis plus fiable et vérifié », 18/11/2026) toute phrase qui a un contenu se vérifie, plus seulement le passé ;
 *  - une reprise emporte CET APPEL, JUSQU'ICI ;
 *  - les discussions se retrouvent par la racine des mots (« disques » → « disque »).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appelEnCoursPourLaVoix,
  consigneDeLaVoix,
  demandeDeCoupure,
  jarvisAnnonceSaCoupure,
  demandeAVerifier,
  texteDuDossier,
  pertinenceDUneDiscussion,
  PHRASE_DE_COUPURE,
  salutDeJarvis,
} from '@beluga/shared';

test('« coupe-toi » se lit au milieu d’une phrase longue, et seulement quand il parle de Jarvis', () => {
  assert.ok(demandeDeCoupure('Ah mais j’en sais rien, coupe toi, j’y reviendrai à toi quand j’aurai trouvé une solution'));
  assert.ok(demandeDeCoupure('Coupe-toi.'));
  assert.ok(demandeDeCoupure('Bon, tais-toi deux minutes'));
  assert.ok(demandeDeCoupure('ok je reviens vers toi plus tard'));
  assert.ok(demandeDeCoupure('Tu peux raccrocher'));
  for (const leurre of ['Coupe la vidéo', 'coupe le son du site', 'arrête la tâche du disque', 'le serveur s’est coupé hier', 'toi tu coupes les cheveux', '']) {
    assert.ok(!demandeDeCoupure(leurre), leurre);
  }
});

test('l’annonce de Jarvis ferme aussi : « je me coupe », « Entendu, j’arrête. », « j’attends que tu reviennes »', () => {
  assert.ok(jarvisAnnonceSaCoupure(PHRASE_DE_COUPURE));
  assert.ok(jarvisAnnonceSaCoupure('Entendu, j’arrête.'));
  assert.ok(jarvisAnnonceSaCoupure('D’accord, je me tais et j’attends que tu reviennes.'));
  assert.ok(jarvisAnnonceSaCoupure('D’accord, je me mets en veille.'));
  for (const leurre of ['J’arrête la tâche du disque.', 'J’arrête ce que je faisais à l’écran.', 'Salut Chris, je t’écoute.', 'Je regarde.']) {
    assert.ok(!jarvisAnnonceSaCoupure(leurre), leurre);
  }
  assert.match(consigneDeLaVoix('Jarvis', 'Chris'), /dis seulement « D’accord, je me coupe\. »/);
});

test('toute phrase qui a un contenu se vérifie ; un appel, un accusé, la fin ou la veille, non', () => {
  for (const q of [
    'Tu te rappelles de quoi on a parlé juste avant',
    'Qu’est-ce qui est en cours',
    'Ouvre la tâche du disque',
    'T’as vraiment l’impression que les précédentes cartes ont amélioré le système de réflexion ?',
    'Tu tournes sur quel modèle',
  ]) {
    assert.ok(demandeAVerifier(q, 'Jarvis'), q);
  }
  for (const q of ['Jarvis', 'Dis Jarvis', 'ok merci', 'Oui.', 'c’est bon', 'Mets-toi en veille', 'Coupe-toi', '']) assert.ok(!demandeAVerifier(q, 'Jarvis'), q);
});

test('le dossier cite chaque source, ses identifiants, et dit ce qui n’a pas répondu à temps', () => {
  const plein = texteDuDossier('ce qu’on a dit sur le disque', {
    discussions: ['- DISC-0038, le 18/11 07:30 : Disque de Beluga à 70 %'],
    memoire: ['- MEM-1252 — Conversation vocale : …'],
    cartes: ['- « Disque de Beluga à 70 % » — projet HaikoInfra'],
    activite: 'TÂCHES EN COURS (en ce moment) — Aucune tâche en cours.',
  });
  assert.match(plein, /^DOSSIER DE BELUGA pour « ce qu’on a dit sur le disque »/);
  assert.match(plein, /MÉMOIRE DE BELUGA[^\n]*:\n- MEM-1252/);
  assert.match(plein, /DISCUSSIONS VOCALES PASSÉES[^\n]*:\n- DISC-0038/);
  assert.match(plein, /TÂCHES APPROCHANTES, TOUS PROJETS :\n- « Disque de Beluga à 70 % »/);
  assert.match(plein, /ACTIVITÉ EN CE MOMENT :\nTÂCHES EN COURS/);
  const tard = texteDuDossier('x', { discussions: [], memoire: [], cartes: [], enRetard: ['memoire'] });
  assert.match(tard, /Sans réponse à temps : memoire/);
  assert.ok(texteDuDossier('x', { discussions: [`- ${'a'.repeat(9000)}`], memoire: [], cartes: [] }).length <= 6000);
});

test('une reprise emporte CET APPEL, JUSQU’ICI, les derniers tours d’abord gardés', () => {
  const tours = [
    { role: 'user', texte: 'Tu peux me dire ce qu’il y a dans la tâche de Beluga 70%' },
    { role: 'assistant', texte: '« Disque de Beluga à 70 % », c’est dans HaikoInfra.' },
  ];
  const appel = appelEnCoursPourLaVoix(tours);
  assert.equal(appel, 'Toi : Tu peux me dire ce qu’il y a dans la tâche de Beluga 70%\nJarvis : « Disque de Beluga à 70 % », c’est dans HaikoInfra.');
  const c = consigneDeLaVoix('Jarvis', 'Chris', { reprise: true, appelEnCours: appel });
  assert.match(c, /CET APPEL, JUSQU’ICI \(ce qui vient d’être dit, le plus ancien d’abord\) :\nToi : Tu peux me dire/);
  const long = appelEnCoursPourLaVoix(Array.from({ length: 200 }, (_, i) => ({ role: 'user', texte: `phrase numéro ${i} ${'x'.repeat(40)}` })));
  assert.ok(long.length <= 3500 && long.endsWith(`phrase numéro 199 ${'x'.repeat(40)}`), 'la fin de l’appel est gardée');
});

test('les discussions se retrouvent par la racine des mots, et les mots vides ne comptent pas', () => {
  assert.ok(pertinenceDUneDiscussion('ce qu’on a dit sur les disques', 'La tâche « Disque de Beluga à 70 % » est dans HaikoInfra') >= 0.34);
  assert.equal(pertinenceDUneDiscussion('tu te souviens hier', 'rien à voir avec la question'), 0);
  assert.ok(pertinenceDUneDiscussion('la tâche Beluga 70', 'Disque de Beluga à 70 %') >= 0.5);
});

test('le salut est « Salut <prénom>, je t’écoute. »', () => {
  assert.equal(salutDeJarvis('Chris'), 'Salut Chris, je t’écoute.');
});
