import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENEMENTS_PAR_ETAPE_MAX,
  TEXTE_EVENEMENT_MAX,
  ajouterAuJournal,
  ecartDepuisLeDebut,
  filDeLEtape,
  heureDeLEvenement,
  resumeDuFil,
  titreDeLaPublication,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* CE QUI ENTRE DANS LE FIL, ET CE QUI N'Y ENTRE PAS                    */
/* ------------------------------------------------------------------ */

test('un moment s’ajoute à la fin, sans toucher au fil reçu', () => {
  const avant = [{ at: 10, genre: 'debut' as const, texte: 'L’étape commence.' }];
  const apres = ajouterAuJournal(avant, { at: 20, genre: 'progression', texte: 'Branche 1 sur 3' });
  assert.equal(apres.length, 2);
  assert.equal(apres[1].texte, 'Branche 1 sur 3');
  // Le fil reçu n'est jamais modifié sur place : l'appelant garde le sien.
  assert.equal(avant.length, 1);
});

test('un fil encore inexistant se remplit sans qu’on ait à le créer', () => {
  const apres = ajouterAuJournal(undefined, { at: 1, genre: 'debut', texte: 'Départ.' });
  assert.deepEqual(apres, [{ at: 1, genre: 'debut', texte: 'Départ.' }]);
});

test('un texte vide n’entre pas — la progression est parfois réémise à blanc', () => {
  const fil = ajouterAuJournal([], { at: 1, genre: 'progression', texte: '   ' });
  assert.equal(fil.length, 0);
});

test('la MÊME ligne réémise ne se réécrit pas', () => {
  // Le serveur réémet l'état de la publication à chaque pas : sans ce refus,
  // une progression inchangée remplirait le fil de doublons.
  let fil = ajouterAuJournal([], { at: 1, genre: 'progression', texte: 'Branche 1 sur 3' });
  fil = ajouterAuJournal(fil, { at: 2, genre: 'progression', texte: 'Branche 1 sur 3' });
  assert.equal(fil.length, 1);
  // Mais la même phrase d'un AUTRE genre est un autre moment : elle entre.
  fil = ajouterAuJournal(fil, { at: 3, genre: 'issue', texte: 'Branche 1 sur 3' });
  assert.equal(fil.length, 2);
});

test('un doublon NON consécutif entre : la même branche peut revenir', () => {
  let fil = ajouterAuJournal([], { at: 1, genre: 'progression', texte: 'Branche A' });
  fil = ajouterAuJournal(fil, { at: 2, genre: 'progression', texte: 'Branche B' });
  fil = ajouterAuJournal(fil, { at: 3, genre: 'progression', texte: 'Branche A' });
  assert.equal(fil.length, 3);
});

test('un refus rend le fil TEL QUEL : l’appelant peut le reconnaître', () => {
  // C'est ce que `noterAuJournal` (server/src/deploy.ts) teste pour savoir s'il
  // doit réémettre la publication : sans identité conservée, il réémettrait à
  // chaque tour pour rien.
  const fil = [{ at: 1, genre: 'progression' as const, texte: 'Branche A' }];
  assert.equal(ajouterAuJournal(fil, { at: 2, genre: 'progression', texte: 'Branche A' }), fil);
  assert.equal(ajouterAuJournal(fil, { at: 2, genre: 'progression', texte: '' }), fil);
});

test('un texte trop long est coupé, jamais refusé', () => {
  const fil = ajouterAuJournal([], { at: 1, genre: 'commande', texte: 'x'.repeat(5000) });
  assert.equal(fil[0].texte.length, TEXTE_EVENEMENT_MAX);
});

test('au-delà du plafond, ce sont les PLUS ANCIENS qui partent', () => {
  let fil: ReturnType<typeof ajouterAuJournal> = [];
  for (let i = 0; i < EVENEMENTS_PAR_ETAPE_MAX + 30; i++) {
    fil = ajouterAuJournal(fil, { at: i, genre: 'progression', texte: `moment ${i}` });
  }
  assert.equal(fil.length, EVENEMENTS_PAR_ETAPE_MAX);
  // La FIN est ce qu'on vient lire : elle est intacte.
  assert.equal(fil[fil.length - 1].texte, `moment ${EVENEMENTS_PAR_ETAPE_MAX + 29}`);
  assert.equal(fil[0].texte, 'moment 30');
});

/* ------------------------------------------------------------------ */
/* CE QUE LE FIL DIT À L'ÉCRAN                                          */
/* ------------------------------------------------------------------ */

test('l’heure garde ses SECONDES : deux branches d’une même minute se distinguent', () => {
  const at = new Date(2026, 7, 17, 14, 32, 7).getTime();
  assert.equal(heureDeLEvenement(at), '14:32:07');
});

test('l’écart depuis le début se lit sans soustraction de tête', () => {
  assert.equal(ecartDepuisLeDebut(1000 + 4000, 1000), '+4 s');
  assert.equal(ecartDepuisLeDebut(1000 + 120_000, 1000), '+2 min');
  assert.equal(ecartDepuisLeDebut(1000 + 3_900_000, 1000), '+1 h 5 min');
});

test('sans début connu, aucun écart n’est inventé', () => {
  assert.equal(ecartDepuisLeDebut(5000, undefined), null);
  // Un moment ANTÉRIEUR au début de l'étape ne rend pas un écart négatif.
  assert.equal(ecartDepuisLeDebut(500, 1000), null);
});

test('une étape sans rien à raconter n’affiche pas un « 0 »', () => {
  assert.equal(resumeDuFil(undefined), null);
  assert.equal(resumeDuFil([]), null);
  assert.equal(resumeDuFil([{ at: 1, genre: 'debut', texte: 'a' }]), '1 moment');
  assert.equal(
    resumeDuFil([
      { at: 1, genre: 'debut', texte: 'a' },
      { at: 2, genre: 'issue', texte: 'b' },
    ]),
    '2 moments',
  );
});

/* ------------------------------------------------------------------ */
/* LE FIL PRÊT À AFFICHER : DEUX SOURCES, AUCUNE PERDUE                 */
/* ------------------------------------------------------------------ */

test('une publication d’AVANT cette règle garde un fil lisible : ses réparations', () => {
  const lignes = filDeLEtape({ reparations: ['Panne reconnue : conflit de fusion.', 'Reprise réussie.'] });
  assert.equal(lignes.length, 2);
  assert.equal(lignes[0].genre, 'depannage');
  // Un récit de réparation n'a PAS d'instant : on ne lui en invente pas.
  assert.equal(lignes[0].evenement, null);
});

test('le fil et les réparations se suivent, sans se répéter', () => {
  const lignes = filDeLEtape({
    journal: [{ at: 1, genre: 'depannage', texte: 'Reprise réussie.' }],
    reparations: ['Reprise réussie.', 'Deuxième passage.'],
  });
  assert.deepEqual(
    lignes.map((l) => l.texte),
    ['Reprise réussie.', 'Deuxième passage.'],
  );
});

test('une étape vierge rend un fil vide, jamais une panne', () => {
  assert.deepEqual(filDeLEtape({}), []);
});

/* ------------------------------------------------------------------ */
/* LE TITRE D'UNE PUBLICATION                                           */
/* ------------------------------------------------------------------ */

test('le titre porte la date en toutes lettres et l’heure', () => {
  const at = new Date(2026, 7, 17, 9, 5).getTime();
  assert.equal(titreDeLaPublication('Déploiement', at), 'Déploiement du 17 août, 09:05');
});
