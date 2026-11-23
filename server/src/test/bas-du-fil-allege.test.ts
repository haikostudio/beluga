import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { veilleTientLaRangee } from '@beluga/shared';
import { TEXTES_TRADUITS } from '@beluga/shared/traductions';

/* ------------------------------------------------------------------ */
/* LE BAS DU FIL ALLÉGÉ — demande du 24/10/2026.                        */
/*                                                                     */
/* Sur téléphone, le pied d'une carte mangeait la hauteur du fil :      */
/*  - pendant une veille, ses gestes s'AJOUTAIENT à la rangée d'action ; */
/*    ils la REMPLACENT désormais, et la rangée revient à l'arrêt ;      */
/*  - les messages en attente s'empilaient au-dessus du champ avec une  */
/*    phrase d'explication ; ils tiennent dans UN second décroché en    */
/*    dégradé violet, au-dessus de la ligne d’état (27/10), qui ouvre   */
/*    une feuille du bas.                                               */
/* ------------------------------------------------------------------ */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const lire = (chemin: string) => fs.readFileSync(path.resolve(ICI, '../../../web/src', chemin), 'utf8');

test('une veille en cours ou échue tient la rangée ; arrêtée, levée ou abandonnée, plus', () => {
  assert.equal(veilleTientLaRangee({ etat: 'en_cours' }, false), true);
  assert.equal(veilleTientLaRangee({ etat: 'expiree' }, false), true);
  for (const etat of ['levee', 'abandonnee'] as const) assert.equal(veilleTientLaRangee({ etat }, false), false, etat);
  assert.equal(veilleTientLaRangee(undefined, false), false, 'sans veille, la rangée habituelle');
  assert.equal(veilleTientLaRangee(null, false), false);
});

test('un agent qui travaille malgré la veille garde la rangée habituelle, et son arrêt', () => {
  assert.equal(veilleTientLaRangee({ etat: 'en_cours' }, true), false);
  assert.equal(veilleTientLaRangee({ etat: 'expiree' }, true), false);
});

test('la conversation rend la veille EN RANGÉE à la place de la barre d’action', () => {
  const chat = lire('components/chat.tsx');
  const bloc = chat.split('boutonPrincipal={')[1].split('libelleDuChamp=')[0];
  assert.match(bloc, /veilleTientLaRangee\(carte\.veille, busy\) \? \(\s*<BandeauDeVeille carte=\{carte\} rangee \/>\s*\) : \(/);
  /* La barre d'action n'est rendue que dans l'autre branche. */
  const [avecVeille, sansVeille] = bloc.split(') : (');
  assert.doesNotMatch(avecVeille, /<BarreDAction/);
  assert.match(sansVeille, /<BarreDAction/);
  const veille = lire('components/veille-de-carte.tsx');
  const rangee = veille.split('if (rangee) {')[1].split('\n  }\n')[0];
  assert.match(rangee, /data-rangee-veille/);
  assert.match(rangee, /CLASSES_BOUTON_DU_FIL/, 'mêmes boutons que la rangée d’action');
  assert.match(rangee, /veille\.etat === 'en_cours' \?/, '« Vérifier maintenant » seulement tant qu’elle court');
  assert.match(rangee, /data-veille-arreter/);
  assert.match(rangee, /data-veille-service/, 'le service à la place de l’horloge');
});

test('plus aucune ligne ni phrase de file au-dessus du champ', () => {
  const composer = lire('components/composer.tsx');
  assert.doesNotMatch(composer, /Votre message part dès que/);
  assert.doesNotMatch(composer, /ils partiront l\\'un après l\\'autre/);
  const corps = composer.split('export function Composer(')[1].split('\nfunction ')[0];
  assert.doesNotMatch(corps, /queue\.map\(/, 'la liste ne vit plus que dans le tiroir');
  assert.match(corps, /<FileDAttente/);
  for (const cle of TEXTES_TRADUITS) {
    assert.ok(!cle.startsWith('Votre message part dès que'), cle);
    assert.ok(!cle.includes('ils partiront'), cle);
  }
});

test('le second décroché, au-dessus de la ligne d’état, ouvre une feuille du bas ; le crayon la referme et remonte le message', () => {
  const composer = lire('components/composer.tsx');
  const file = composer.split('function FileDAttente(')[1].split('\nfunction ')[0];
  assert.match(file, /data-file-attente-barre=\{queue\.length\}/);
  assert.doesNotMatch(file, /absolute/, 'plus rien ne flotte : la barre est dans le flux');
  assert.match(file, /w-full/, 'pleine largeur');
  assert.doesNotMatch(file, /FACC15|EAB308/, 'plus de jaune');
  assert.match(file, /decroche-degrade decroche-violet/, 'la classe commune des décrochés');
  assert.doesNotMatch(file, /#3B82F6|border-\[#/i, 'le violet vit dans la feuille de style, jamais en dur dans l’écran');
  assert.match(file, /\[--hauteur-du-degrade:36px\].*sm:\[--hauteur-du-degrade:32px\]/, 'le dégradé tient sur la hauteur visible');
  const css = lire('styles.css');
  assert.match(css, /\.decroche-violet \{\s*--couleur-du-decroche: hsl\(var\(--teinte\)\);\s*--gris-du-decroche: hsl\(var\(--decroche-attente\)\)/, 'le violet de la palette (--teinte), fini dans le gris de la file');
  assert.doesNotMatch(css, /decroche-bleu|#3b82f6/, 'plus aucun bleu fixe');
  /* PLUS AUCUN DÉGRADÉ NI BORDURE (14/11/2026) : un aplat, la profondeur par le seul écart de fond. */
  assert.match(css, /\.decroche-degrade \{\s*border: 0;\s*background: var\(--gris-du-decroche\);/, 'un aplat sans bordure');
  assert.doesNotMatch(css, /\) border-box;/, 'plus de bordure en dégradé');
  /* EN CLAIR (29/10/2026, capture #42b7) : fond plein gris, ni dégradé ni bordure ; seuls l'icône et le libellé en violet. */
  assert.match(css, /html:not\(\.dark\) \.decroche-violet \{\s*border-color: transparent;\s*background: hsl\(var\(--decroche-attente\)\);/, 'en clair, un fond plein dans le gris de la file, sans bordure');
  assert.match(css, /html:not\(\.dark\) \.decroche-violet \.encre-du-decroche \{\s*color: hsl\(var\(--teinte\)\);/, 'en clair, l’icône et le libellé en violet');
  assert.doesNotMatch(css, /html:not\(\.dark\) \.decroche-violet[^{]*\{[^}]*--part-de-couleur/, 'en clair, plus aucune part de violet dans le fond');
  assert.equal((file.match(/className="encre-du-decroche /g) ?? []).length, 2, 'l’icône et le libellé portent l’encre violette, pas la flèche');
  const chatSrc = lire('components/chat.tsx');
  assert.match(chatSrc, /'decroche-degrade decroche-gris \[--hauteur-du-degrade:34px\]'/, 'la liste des tâches en dégradé gris');
  assert.match(css, /\.decroche-gris \{[^}]*--couleur-du-decroche: hsl\(var\(--faint\)\)/, 'plus de violet : un gris, bordure comprise');
  assert.match(css, /\.decroche-gris \{[^}]*--fond-zone-defilement: hsl\(var\(--decroche\)\)/, 'la liste fond dans le gris du bas');
  assert.match(file, /relative z-0 -mb-3 .*rounded-t-lg/, 'le gabarit du décroché : passe 12 px sous le suivant');
  assert.doesNotMatch(file, /mb-1\.5/, 'aucun écart sous la barre');
  /* Posée AVANT la ligne d'état (et le menu « / »), qui reste collée au champ. */
  const corps = composer.split('export function Composer(')[1].split('\nfunction ')[0];
  const travail = corps.indexOf('{barreTravail}');
  const barre = corps.indexOf('<FileDAttente');
  const slash = corps.indexOf('<MenuSlash');
  const champ = corps.indexOf('data-champ-d-ecriture');
  assert.ok(barre > 0 && slash > barre && travail > barre && champ > travail, 'file d’attente, ligne d’état, puis champ');
  assert.match(file, /<Drawer open=\{ouvert\} onClose=\{\(\) => setOuvert\(false\)\} feuille>/);
  assert.match(file, /<ZoneDefilement/);
  assert.match(file, /data-file-attente-tiroir/);
  assert.match(file, /onEdit=\{\(\) => \{\s*setOuvert\(false\);\s*onEdit\(item\);/);
  /* Le pied reste le repère de position (le bouton photo du téléphone s'y pose). */
  const chat = lire('components/chat.tsx');
  assert.match(chat, /className="relative flex shrink-0 flex-col" data-pied-de-conversation/);
  assert.match(chat, /className="relative shrink-0" data-pied-du-fil/);
});

test('un message en attente montre ses fichiers en pastilles', () => {
  const composer = lire('components/composer.tsx');
  const item = composer.split('function QueuedItem(')[1];
  assert.match(item, /tagsDuTexte\(apercu\)/);
});

test('le cadre jaune entoure le panneau « Une décision attend », et la question qu’il contient n’en porte plus', () => {
  const panneau = lire('components/parcours-carte.tsx');
  assert.match(panneau, /enErreur \? 'border-danger\/40' : 'cadre-de-question'/, 'le panneau porte le trait jaune, sauf en erreur');
  assert.match(panneau, /<CadreDuPanneau\.Provider value=\{!enErreur\}>/, 'il le dit aux bulles qu’il contient');
  const contexte = lire('lib/cadre-de-question.ts');
  assert.match(contexte, /React\.useContext\(CadreDuPanneau\) \? undefined : 'cadre-de-question'/);
  for (const fichier of ['components/bulle-question.tsx', 'components/validation-avec-cout.tsx']) {
    const source = lire(fichier);
    assert.match(source, /useClasseDuCadreDeQuestion\(\)/, `${fichier} : le cadre suit le panneau`);
    assert.doesNotMatch(source, /className=\{cn\('cadre-de-question/, `${fichier} : plus de cadre jaune imposé`);
  }
});
