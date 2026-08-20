import test from 'node:test';
import assert from 'node:assert/strict';

/* ------------------------------------------------------------------ */
/* CE QUE LE TRI DE LA MÉMOIRE ÉCONOMISE — MESURÉ, PAS ANNONCÉ.        */
/*                                                                     */
/* L'économie du tri était CHIFFRÉE UNE FOIS, sur un sujet d'essai, et */
/* jamais suivie ensuite. Le tableau de bord l'additionne désormais    */
/* sur un mois glissant ; ces règles-là sont ce qui traduit deux       */
/* longueurs de texte en une phrase lisible.                          */
/* ------------------------------------------------------------------ */

const { SIGNES_PAR_JETON, economieMemoire, economieMoyenneParCarte } = await import('@haikodev/shared');

test('l’économie est une soustraction entre deux textes, pas une estimation', () => {
  const calcul = economieMemoire(140870, 7697);
  assert.equal(calcul.signesEvites, 140870 - 7697);
  assert.equal(calcul.jetonsEvites, Math.round((140870 - 7697) / SIGNES_PAR_JETON));
  // 94,5 % — la part que la carte d'origine avait mesurée à la main.
  assert.ok(calcul.part > 0.94 && calcul.part < 0.95);
});

test('sans rapport jetons → quota relevé, aucune part de quota n’est inventée', () => {
  assert.equal(economieMemoire(1000, 100).quotaEvite, undefined);
  assert.equal(economieMemoire(1000, 100, 0).quotaEvite, undefined);
  assert.equal(economieMemoire(1000, 100, null).quotaEvite, undefined);
});

test('avec le rapport relevé, la part de quota suit les jetons évités', () => {
  const calcul = economieMemoire(22000, 0, 0.001);
  assert.equal(calcul.jetonsEvites, 10000);
  assert.equal(calcul.quotaEvite, 10);
});

test('un tri qui n’a rien rogné n’économise rien, et rien ne passe sous zéro', () => {
  assert.equal(economieMemoire(500, 500).signesEvites, 0);
  assert.equal(economieMemoire(500, 500).part, 0);
  // Un servi PLUS GROS que l'entier ne peut pas arriver ; s'il arrive, il vaut zéro.
  assert.equal(economieMemoire(100, 900).signesEvites, 0);
  assert.equal(economieMemoire(0, 0).part, 0);
});

test('la moyenne par carte ne compte que les cartes qui ont ouvert la mémoire', () => {
  assert.equal(economieMoyenneParCarte([{ signesEvites: 100 }, { signesEvites: 300 }]), 200);
  assert.equal(economieMoyenneParCarte([]), 0);
});
