import test from 'node:test';
import assert from 'node:assert/strict';

import { confianceDeLaReponse, lignesDeRetenue, lireLaReponse, poserLaRetenue, reponseRetenue } from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* LA FAÇADE RETIENT, ELLE NE REFUSE PLUS                              */
/*                                                                     */
/* Un redémarrage de site dure de 0,9 s à 6,4 s sur ce serveur, et     */
/* chaque visite tombée pendant ce trou reçoit une erreur 502. La      */
/* façade sait garder la requête en main et la rejouer : encore       */
/* faut-il que les trois réglages soient POSÉS sur chaque site, et     */
/* qu'un fichier régénéré sans eux se VOIE.                            */
/* ------------------------------------------------------------------ */

test('la retenue se pose dans chaque bloc de destinataire, une seule fois', () => {
  const avant = [
    'site.exemple {',
    '\tencode gzip',
    '\treverse_proxy 127.0.0.1:15000 {',
    '\t\theader_up Host {upstream_hostport}',
    '\t}',
    '}',
  ].join('\n');

  const bilan = poserLaRetenue(avant);
  assert.deepEqual(bilan.poses, ['127.0.0.1:15000']);
  for (const ligne of lignesDeRetenue()) assert.ok(bilan.texte.includes(ligne), `manque : ${ligne}`);
  /* Le header d'origine n'a pas bougé : on AJOUTE, on ne réécrit pas. */
  assert.ok(bilan.texte.includes('header_up Host {upstream_hostport}'));

  /* Repasser dessus ne double rien : c'est ce qui rend le script rejouable. */
  const second = poserLaRetenue(bilan.texte);
  assert.deepEqual(second.poses, []);
  assert.deepEqual(second.dejaPoses, ['127.0.0.1:15000']);
  assert.equal(second.texte, bilan.texte);
});

test('un destinataire écrit sans bloc en reçoit un', () => {
  const bilan = poserLaRetenue('site {\n\treverse_proxy 127.0.0.1:14999\n}');
  assert.deepEqual(bilan.poses, ['127.0.0.1:14999']);
  assert.ok(bilan.texte.includes('reverse_proxy 127.0.0.1:14999 {'));
  assert.ok(bilan.texte.includes('fail_duration 0'));
});

test('un site déjà réglé à la main n’est pas retouché', () => {
  const texte = 'site {\n\treverse_proxy 127.0.0.1:1 {\n\t\tlb_try_duration 5s\n\t}\n}';
  assert.deepEqual(poserLaRetenue(texte).poses, []);
  assert.equal(poserLaRetenue(texte).texte, texte);
});

/* ------------------------------------------------------------------ */
/* LE JUGE RAPIDE : JEV RÉPOND, ET SE TAIT QUAND IL DOUTE             */
/* ------------------------------------------------------------------ */

const NOTE = {
  type: 'score' as const,
  instructions: 'À quel point ce dossier suffit-il ?',
  criteria: ['Pas du tout.', 'À peu près.', 'Tout à fait.'],
};
const CHOIX = {
  type: 'choice' as const,
  instructions: 'Qu’est-ce qui manque ?',
  criteria: { but: 'Le but.', limites: 'Les limites.' },
};
const OUI_NON = {
  type: 'noul' as const,
  instructions: 'Cette demande presse-t-elle ?',
  criteria: { true: 'Quelque chose est cassé.', false: 'Rien ne se dégrade.' },
};

/** Une réponse de Jev telle que l'API la rend, lue par `lireLaReponse`. */
const lu = (reponse: Record<string, unknown>) => lireLaReponse({ answers: { q: reponse } })?.reponses.q;

test('la confiance lue est celle de Jev, et pour un oui/non la probabilité du côté retenu', () => {
  assert.equal(confianceDeLaReponse(lu({ type: 'choice', choice: 'but', probabilities: { but: 0.51 }, confidence: 0.51 })), 0.51);
  assert.equal(confianceDeLaReponse(lu({ type: 'noul', noul: 0.1 })), 0.9, 'un « non » franc est une réponse sûre');
  assert.equal(confianceDeLaReponse(undefined), 0);
});

test('une note garde l’espérance rendue par Jev, bornée à l’échelle', () => {
  const reponse = reponseRetenue(NOTE, lu({ type: 'score', score: 1.62, confidence: 0.7 }), 0.4) as any;
  assert.equal(reponse?.type, 'score');
  assert.equal(reponse.score, 1.62);
  assert.equal(reponse.confidence, 0.7);
  assert.equal((reponseRetenue(NOTE, lu({ type: 'score', score: 7, confidence: 0.9 })) as any).score, 2);
  assert.equal(lu({ type: 'score', score: Number.NaN, confidence: 0.9 }), undefined);
});

test('un choix hors de la liste offerte est refusé', () => {
  assert.equal(reponseRetenue(CHOIX, lu({ type: 'choice', choice: 'autre-chose', confidence: 0.99 })), undefined);
  assert.equal((reponseRetenue(CHOIX, lu({ type: 'choice', choice: 'but', confidence: 0.99 })) as any)?.choice, 'but');
});

test('un oui/non rend la probabilité du oui, dans les deux sens', () => {
  assert.equal((reponseRetenue(OUI_NON, lu({ type: 'noul', noul: 0.93 })) as any).noul, 0.93);
  assert.equal((reponseRetenue(OUI_NON, lu({ type: 'noul', noul: 0.05 })) as any).noul, 0.05);
});

test('sous le seuil, ou d’un autre genre, aucune réponse : l’appelant retombe sur son comportement d’avant', () => {
  assert.equal(reponseRetenue(CHOIX, lu({ type: 'choice', choice: 'but', confidence: 0.52 }), 0.6), undefined);
  assert.equal(reponseRetenue(NOTE, lu({ type: 'choice', choice: 'but', confidence: 0.99 })), undefined);
  assert.equal(reponseRetenue(NOTE, undefined), undefined);
  assert.equal(lireLaReponse({ pas: 'de réponses' }), undefined, 'une réponse mal formée ne lève pas');
});
