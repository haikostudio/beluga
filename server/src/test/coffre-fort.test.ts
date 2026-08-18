import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AccesCoffre,
  CHAMPS_PAR_TYPE,
  LIBELLE_TYPE_ACCES,
  TYPES_ACCES,
  apercuAcces,
  champEstSecret,
  champsDuType,
  filtrerAcces,
  jugerAcces,
  normaliserRecherche,
  texteCherchable,
  trierAcces,
} from '@haikodev/shared';

/**
 * LE COFFRE-FORT — les règles qui se jugent sans base ni disque.
 *
 * Ce que ces tests verrouillent : un type inconnu refusé, les champs d'un autre
 * type jetés au changement de type, une recherche qui trouve par le nom, le
 * projet et le type MAIS JAMAIS par une valeur secrète, et un aperçu de liste
 * qui ne laisse échapper aucun mot de passe.
 */

function fiche(partiel: Partial<AccesCoffre> = {}): AccesCoffre {
  return {
    id: 'a',
    nom: 'Accès',
    type: 'cle-api',
    projectId: null,
    champs: {},
    note: '',
    creeLe: 0,
    modifieLe: 0,
    origine: 'coffre',
    ...partiel,
  };
}

/* ------------------------------------------------------------------ */
/* Le catalogue des types                                              */
/* ------------------------------------------------------------------ */

test('chaque type a un libellé et au moins un champ', () => {
  for (const type of TYPES_ACCES) {
    assert.ok(LIBELLE_TYPE_ACCES[type], `libellé manquant pour ${type}`);
    assert.ok(CHAMPS_PAR_TYPE[type].length > 0, `aucun champ pour ${type}`);
  }
});

test('chaque type porte au moins un champ SECRET : sinon il ne serait pas un accès', () => {
  for (const type of TYPES_ACCES) {
    assert.ok(
      champsDuType(type).some((c) => c.secret),
      `aucun champ secret pour ${type}`,
    );
  }
});

test('les clés techniques d’un type ne se répètent pas', () => {
  for (const type of TYPES_ACCES) {
    const cles = champsDuType(type).map((c) => c.cle);
    assert.equal(new Set(cles).size, cles.length, `clé en double dans ${type}`);
  }
});

/* ------------------------------------------------------------------ */
/* Ce qui arrive du navigateur                                         */
/* ------------------------------------------------------------------ */

test('un nom vide est refusé, en clair', () => {
  const juge = jugerAcces({ nom: '   ', type: 'cle-api' });
  assert.equal(juge.ok, false);
  assert.match((juge as any).raison, /nom/i);
});

test('un type inconnu est refusé', () => {
  const juge = jugerAcces({ nom: 'Truc', type: 'coffre-magique' });
  assert.equal(juge.ok, false);
});

test('seuls les champs du type sont gardés : un reste d’un autre type est jeté', () => {
  const juge = jugerAcces({
    nom: 'Ma clé',
    type: 'cle-api',
    champs: { cle: 'sk-123', motDePasse: 'reste-d-un-accès-ssh', hote: '10.0.0.1' },
  });
  assert.equal(juge.ok, true);
  if (!juge.ok) return;
  assert.deepEqual(Object.keys(juge.champs).sort(), ['cle']);
});

test('un projet vide vaut « aucun projet », pas une chaîne vide', () => {
  const juge = jugerAcces({ nom: 'Ma clé', type: 'cle-api', projectId: '   ' });
  assert.equal(juge.ok, true);
  if (!juge.ok) return;
  assert.equal(juge.projectId, null);
});

test('une valeur démesurée est refusée en nommant son champ', () => {
  const juge = jugerAcces({ nom: 'Ma clé', type: 'cle-api', champs: { cle: 'x'.repeat(20001) } });
  assert.equal(juge.ok, false);
  assert.match((juge as any).raison, /Clé/);
});

/* ------------------------------------------------------------------ */
/* La recherche                                                        */
/* ------------------------------------------------------------------ */

test('la recherche ignore accents et majuscules', () => {
  assert.equal(normaliserRecherche('Clé D’ACCÈS'), 'cle d’acces');
});

test('une valeur SECRÈTE n’entre jamais dans le texte cherchable', () => {
  const texte = texteCherchable(
    fiche({ type: 'mot-de-passe', champs: { identifiant: 'paul', motDePasse: 'tr0ub4dour' } }),
  );
  assert.ok(texte.includes('paul'));
  assert.equal(texte.includes('tr0ub4dour'), false);
});

test('on trouve par le nom, par le projet et par le type — dans n’importe quel ordre', () => {
  const liste = [
    fiche({ id: '1', nom: 'Clé OVH', type: 'cle-api', projectId: 'p1' }),
    fiche({ id: '2', nom: 'Console Hetzner', type: 'mot-de-passe', projectId: 'p2' }),
    fiche({ id: '3', nom: 'Machine de secours', type: 'ssh', projectId: 'p1' }),
  ];
  const projet = (id: string | null) => (id === 'p1' ? 'Boutique' : 'Blog');

  assert.deepEqual(filtrerAcces(liste, 'ovh', projet).map((a) => a.id), ['1']);
  assert.deepEqual(filtrerAcces(liste, 'boutique', projet).map((a) => a.id), ['1', '3']);
  assert.deepEqual(filtrerAcces(liste, 'ssh', projet).map((a) => a.id), ['3']);
  // Deux mots, ordre libre : les deux doivent se retrouver.
  assert.deepEqual(filtrerAcces(liste, 'boutique cle', projet).map((a) => a.id), ['1']);
  assert.deepEqual(filtrerAcces(liste, 'cle boutique', projet).map((a) => a.id), ['1']);
});

test('une recherche vide rend toute la liste', () => {
  const liste = [fiche({ id: '1' }), fiche({ id: '2' })];
  assert.equal(filtrerAcces(liste, '   ').length, 2);
});

/* ------------------------------------------------------------------ */
/* L'aperçu et le classement                                           */
/* ------------------------------------------------------------------ */

test('l’aperçu d’un accès SSH se lit, et ne dit jamais le mot de passe', () => {
  const acces = fiche({
    type: 'ssh',
    champs: { hote: '203.0.113.10', utilisateur: 'root', port: '2222', motDePasse: 'secret' },
  });
  assert.equal(apercuAcces(acces), 'root@203.0.113.10:2222');
});

test('le port 22, qui va de soi, ne s’écrit pas dans l’aperçu', () => {
  const acces = fiche({ type: 'ssh', champs: { hote: '203.0.113.10', utilisateur: 'root', port: '22' } });
  assert.equal(apercuAcces(acces), 'root@203.0.113.10');
});

test('aucun aperçu ne laisse fuir une valeur secrète', () => {
  for (const type of TYPES_ACCES) {
    const champs: Record<string, string> = {};
    for (const champ of champsDuType(type)) champs[champ.cle] = champ.secret ? 'NE-DOIT-PAS-PARAITRE' : 'visible';
    const apercu = apercuAcces(fiche({ type, champs }));
    assert.equal(apercu.includes('NE-DOIT-PAS-PARAITRE'), false, `fuite dans l'aperçu de ${type}`);
  }
});

test('champEstSecret dit vrai du mot de passe et faux de l’identifiant', () => {
  assert.equal(champEstSecret('mot-de-passe', 'motDePasse'), true);
  assert.equal(champEstSecret('mot-de-passe', 'identifiant'), false);
  assert.equal(champEstSecret('mot-de-passe', 'champ-inconnu'), false);
});

test('le plus récemment touché remonte en tête', () => {
  const liste = [
    fiche({ id: 'vieux', nom: 'A', modifieLe: 10 }),
    fiche({ id: 'neuf', nom: 'B', modifieLe: 50 }),
  ];
  assert.deepEqual(trierAcces(liste).map((a) => a.id), ['neuf', 'vieux']);
});
